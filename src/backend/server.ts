import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import type { RuntimeConfig } from "./config.js";
import type {
  ControlClientMessage,
  ControlServerMessage,
  TmuxStateSnapshot
} from "../shared/protocol.js";
import { randomToken } from "./util/random.js";
import { AuthService } from "./auth/auth-service.js";
import type { TmuxGateway } from "./tmux/types.js";
import { TerminalRuntime } from "./pty/terminal-runtime.js";
import type { PtyFactory } from "./pty/pty-adapter.js";
// fast-json-patch ships as CommonJS — the runtime ESM loader rejects
// named imports against it. Default-import the module and destructure.
import fastJsonPatch from "fast-json-patch";
const { compare } = fastJsonPatch;
import { TmuxStateMonitor } from "./state/state-monitor.js";
import { SysinfoSampler } from "./sysinfo/sysinfo-sampler.js";
import { buildFilesRouter } from "./files/routes.js";
import { buildFsPickerRouter } from "./fs-picker/routes.js";
import { buildShellHistoryRouter } from "./shell-history/routes.js";

/**
 * Slot id (ADR-0013): 0..3, position-indexed. Server stores per-slot state
 * inside each ControlContext so a single browser can attach up to four tmux
 * sessions in parallel. Missing/invalid `slot` fields normalize to 0 — the
 * single-pane code path is the slot-0 path.
 */
type SlotId = 0 | 1 | 2 | 3;

interface SlotContext {
  slot: SlotId;
  runtime?: TerminalRuntime;
  /** Managed (grouped) session name owned by this slot. */
  attachedSession?: string;
  /** Base session this slot's grouped client mirrors. */
  baseSession?: string;
  /**
   * Dimensions reported by the frontend via `terminal_ready` for THIS slot.
   * Each slot measures independently because layout reflows give them
   * different cell grids. attach + seedScrollback are gated on this so tmux
   * is never spawned at a stale default size.
   */
  initialDimensions?: { cols: number; rows: number };
  attachStarted: boolean;
  terminalClients: Set<DataContext>;
}

interface ControlContext {
  socket: WebSocket;
  authed: boolean;
  clientId: string;
  slots: Map<SlotId, SlotContext>;
  /**
   * ADR-0015 §2: client declared it understands `tmux_state_delta` at auth
   * time. When false (older client, not negotiated), `broadcastState` always
   * sends the full snapshot for this client.
   */
  stateDelta: boolean;
  /**
   * Last snapshot actually sent to this client (full or post-patch). Used as
   * the base for the next JSON Patch diff. `undefined` → next broadcast will
   * be a full `tmux_state`.
   */
  lastSentState: TmuxStateSnapshot | undefined;
  /**
   * Monotonic version counter, increments on every `tmux_state` /
   * `tmux_state_delta` sent to this client. Reset on `resync_state`.
   */
  stateVersion: number;
}

interface DataContext {
  socket: WebSocket;
  authed: boolean;
  controlClientId?: string;
  controlContext?: ControlContext;
  slot: SlotId;
}

export interface ServerDependencies {
  tmux: TmuxGateway;
  ptyFactory: PtyFactory;
  authService?: AuthService;
  logger?: Pick<Console, "log" | "error">;
}

export interface RunningServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  server: http.Server;
  config: RuntimeConfig;
}

export const frontendFallbackRoute = "/{*path}";

/**
 * A request URL hits the WebSocket endpoints when its path starts with the
 * mount-point's `/ws/` segment. `basePath` is the normalized runtime prefix
 * (empty string for root-mount, `/foo` otherwise); anything shallower than
 * that prefix, or missing the `/ws/` segment, is served as HTTP.
 */
export const isWebSocketPath = (requestPath: string, basePath = ""): boolean =>
  requestPath.startsWith(`${basePath}/ws/`);

const SEED_HISTORY_LINES = 10_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseClientMessage = (raw: string): ControlClientMessage | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || typeof parsed.type !== "string") {
      return null;
    }
    return parsed as ControlClientMessage;
  } catch {
    return null;
  }
};

const sendJson = (socket: WebSocket, payload: ControlServerMessage): void => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

const summarizeClientMessage = (message: ControlClientMessage): string => {
  if (message.type === "auth") {
    return JSON.stringify({
      type: message.type,
      tokenPresent: Boolean(message.token),
      passwordPresent: Boolean(message.password),
      clientIdPresent: Boolean(message.clientId)
    });
  }
  if (message.type === "send_compose") {
    return JSON.stringify({
      type: message.type,
      textLength: message.text.length,
      slot: message.slot ?? 0
    });
  }
  if (message.type === "send_raw") {
    return JSON.stringify({
      type: message.type,
      byteLength: message.bytes.length,
      slot: message.slot ?? 0
    });
  }
  if (message.type === "terminal_ready") {
    return JSON.stringify({
      type: message.type,
      cols: message.cols,
      rows: message.rows,
      slot: message.slot ?? 0
    });
  }
  return JSON.stringify({ type: message.type });
};

const summarizeState = (state: TmuxStateSnapshot): string => {
  const sessions = state.sessions.map((session) => {
    const activeWindow =
      session.windowStates.find((windowState) => windowState.active) ?? session.windowStates[0];
    const activePane = activeWindow?.panes.find((pane) => pane.active) ?? activeWindow?.panes[0];
    return (
      `${session.name}[attached=${session.attached}]` +
      `{window=${activeWindow ? `${activeWindow.index}:${activeWindow.name}` : "none"},` +
      `pane=${activePane ? `${activePane.id}:zoom=${activePane.zoomed}` : "none"},` +
      `windows=${session.windowStates.length}}`
    );
  });
  return `capturedAt=${state.capturedAt}; sessions=${sessions.join(" | ")}`;
};

const CLIENT_SESSION_PREFIX = "tm-agent-client-";

const isManagedClientSession = (name: string): boolean => name.startsWith(CLIENT_SESSION_PREFIX);

/**
 * Per (clientId, slot) managed session name. Suffixing every slot — including
 * slot 0 — keeps a single naming scheme. Old "tm-agent-client-{id}" names
 * from pre-PR-#3 sessions are still recognized by isManagedClientSession()
 * for shutdown sweeping.
 */
const buildClientSessionName = (clientId: string, slot: SlotId): string =>
  `${CLIENT_SESSION_PREFIX}${clientId}-${slot}`;

const normalizeSlot = (raw: unknown): SlotId => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const n = Math.floor(raw);
  if (n === 0 || n === 1 || n === 2 || n === 3) return n as SlotId;
  return 0;
};

const messageSlot = (message: ControlClientMessage): SlotId => {
  if ("slot" in message && message.slot !== undefined) {
    return normalizeSlot(message.slot);
  }
  return 0;
};

export const createTMAgentServer = (
  config: RuntimeConfig,
  deps: ServerDependencies
): RunningServer => {
  const logger = deps.logger ?? console;
  const verboseDebug = process.env.TM_AGENT_VERBOSE_DEBUG === "1";
  const verboseLog = (...args: unknown[]): void => {
    if (verboseDebug) {
      logger.log(...args);
    }
  };
  const authService = deps.authService ?? new AuthService(config.password, config.token);

  const app = express();
  app.use(express.json());

  const basePath = config.basePath ?? "";
  // Every user-facing mount is namespaced by `basePath` so the app can live
  // under a reverse-proxy subpath without colliding with other services on
  // the same hostname. `mount("/api/foo")` → mounted at `/tmux/api/foo` when
  // basePath is `/tmux`, or plain `/api/foo` when basePath is empty.
  const mount = (suffix: string): string => `${basePath}${suffix}`;

  // `<base href>` cached at serve time so the file is only read when the
  // prefix actually needs rewriting. index.html ships with `<base href="/">`;
  // subpath deploys rewrite it to `<base href="/tmux/">` so every relative
  // URL the frontend issues (REST, WS, assets) resolves under the prefix.
  const indexHtmlPath = path.join(config.frontendDir, "index.html");
  let rewrittenIndexHtml: string | undefined;
  const loadIndexHtml = async (): Promise<string | undefined> => {
    if (rewrittenIndexHtml !== undefined) return rewrittenIndexHtml;
    try {
      const raw = await fs.readFile(indexHtmlPath, "utf8");
      const baseHref = basePath ? `${basePath}/` : "/";
      rewrittenIndexHtml = raw.replace(/<base\s+href="[^"]*"\s*\/?>/, `<base href="${baseHref}">`);
      return rewrittenIndexHtml;
    } catch {
      return undefined;
    }
  };

  app.get(mount("/api/config"), (_req, res) => {
    res.json({
      passwordRequired: authService.requiresPassword(),
      scrollbackLines: config.scrollbackLines,
      pollIntervalMs: config.pollIntervalMs,
      workspaceRoot: config.workspaceRoot,
      basePath
    });
  });

  // File panel API (ADR-0012). Mounted before the static + fallback routes so
  // `/api/files/*` is not swallowed by the SPA index.html fallback.
  app.use(
    mount("/api/files"),
    buildFilesRouter({
      authService,
      getSnapshot: () => monitor?.latestSnapshot,
      maxUploadBytes: config.filesMaxUploadBytes,
      logger
    })
  );

  app.use(mount("/api/shell-history"), buildShellHistoryRouter({ authService, logger }));

  app.use(
    mount("/api/fs-picker"),
    buildFsPickerRouter({
      authService,
      workspaceRoot: config.workspaceRoot,
      logger
    })
  );

  // Static assets live at `basePath/*`. `basePath` is empty for root-mount,
  // so this collapses back to `app.use(express.static(...))`.
  if (basePath) {
    app.use(basePath, express.static(config.frontendDir, { index: false }));
  } else {
    app.use(express.static(config.frontendDir, { index: false }));
  }
  app.get(frontendFallbackRoute, async (req, res) => {
    if (isWebSocketPath(req.path, basePath)) {
      res.status(404).end();
      return;
    }
    // Requests outside the mount point (e.g. `/` when basePath is `/tmux`)
    // are not ours — decline so nginx/caddy can route them elsewhere or
    // return its own 404. Without this, the SPA would shadow sibling apps.
    if (basePath && req.path !== basePath && !req.path.startsWith(`${basePath}/`)) {
      res.status(404).end();
      return;
    }

    // Do not serve the SPA shell for missing built assets. Browsers enforce
    // strict MIME checks for module scripts, so returning index.html for a
    // stale `/assets/*.js` request produces a confusing runtime error instead
    // of a clear 404.
    const pathWithinMount =
      basePath && req.path.startsWith(`${basePath}/`) ? req.path.slice(basePath.length) : req.path;
    if (pathWithinMount.startsWith("/assets/")) {
      res.status(404).end();
      return;
    }

    const html = await loadIndexHtml();
    if (!html) {
      res.status(500).send("Frontend not built. Run npm run build:frontend");
      return;
    }
    res.type("html").send(html);
  });

  const server = http.createServer(app);
  const controlWss = new WebSocketServer({ noServer: true });
  const terminalWss = new WebSocketServer({ noServer: true });
  const controlClients = new Set<ControlContext>();
  const terminalClients = new Set<DataContext>();

  let monitor: TmuxStateMonitor | undefined;
  let sysinfo: SysinfoSampler | undefined;
  let sysinfoUnsupported = false;
  let started = false;
  let stopPromise: Promise<void> | null = null;

  const broadcastSysinfoSample = (): void => {
    const sample = sysinfo?.lastSample;
    if (!sample) return;
    for (const client of controlClients) {
      if (client.authed) {
        sendJson(client.socket, { type: "system_stats", sample });
      }
    }
  };

  const sendSysinfoGreeting = (context: ControlContext): void => {
    if (sysinfoUnsupported) {
      sendJson(context.socket, { type: "system_stats", unsupported: true });
      return;
    }
    const sample = sysinfo?.lastSample;
    if (sample) {
      sendJson(context.socket, { type: "system_stats", sample });
    }
  };

  /**
   * ADR-0015 §2 per-client broadcast. The deltas we produce are JSON Patch
   * (RFC 6902) ops against the client's last seen snapshot. If the diff is
   * larger than 60% of the full snapshot we bail to full-state — the delta
   * framing isn't worth its overhead, and a fresh full anchors the version
   * counter for subsequent small diffs.
   */
  const DELTA_SIZE_THRESHOLD = 0.6;

  const sendFullState = (client: ControlContext, state: TmuxStateSnapshot): void => {
    client.stateVersion += 1;
    client.lastSentState = state;
    sendJson(
      client.socket,
      client.stateDelta
        ? { type: "tmux_state", state, version: client.stateVersion }
        : { type: "tmux_state", state }
    );
  };

  const broadcastState = (state: TmuxStateSnapshot): void => {
    verboseLog(
      "broadcast tmux_state",
      `authedControlClients=${[...controlClients].filter((client) => client.authed).length}`,
      summarizeState(state)
    );
    for (const client of controlClients) {
      if (!client.authed) continue;

      // Legacy path: client never negotiated state-delta → always full.
      if (!client.stateDelta || !client.lastSentState) {
        sendFullState(client, state);
        continue;
      }

      const ops = compare(client.lastSentState, state) as Array<{
        op: string;
        path: string;
        value?: unknown;
      }>;
      if (ops.length === 0) {
        // Nothing to send — stricter than the old monitor-level dedup since
        // we compare per-client against what *this* client last received.
        continue;
      }

      const deltaPayload = JSON.stringify(ops);
      const fullPayload = JSON.stringify(state);
      if (deltaPayload.length >= fullPayload.length * DELTA_SIZE_THRESHOLD) {
        // Diff too big — fall back to full. Cheaper to wire and resets the
        // client's applied-version anchor.
        sendFullState(client, state);
        continue;
      }

      const baseVersion = client.stateVersion;
      client.stateVersion += 1;
      client.lastSentState = state;
      sendJson(client.socket, {
        type: "tmux_state_delta",
        version: client.stateVersion,
        baseVersion,
        capturedAt: state.capturedAt,
        patch: {
          ops: ops as unknown as import("../shared/protocol.js").TmuxStatePatchOp[]
        }
      });
    }
  };

  const getControlContext = (clientId: string): ControlContext | undefined =>
    Array.from(controlClients).find((candidate) => candidate.clientId === clientId);

  const ensureSlot = (context: ControlContext, slot: SlotId): SlotContext => {
    let s = context.slots.get(slot);
    if (!s) {
      s = {
        slot,
        attachStarted: false,
        terminalClients: new Set<DataContext>()
      };
      context.slots.set(slot, s);
    }
    return s;
  };

  const getOrCreateRuntime = (context: ControlContext, slot: SlotContext): TerminalRuntime => {
    if (slot.runtime) {
      return slot.runtime;
    }

    const runtime = new TerminalRuntime(deps.ptyFactory);
    runtime.on("data", (chunk) => {
      verboseLog(
        "runtime data chunk",
        context.clientId,
        `slot=${slot.slot}`,
        `bytes=${Buffer.byteLength(chunk, "utf8")}`
      );
      for (const terminalClient of slot.terminalClients) {
        if (
          terminalClient.authed &&
          terminalClient.socket.readyState === terminalClient.socket.OPEN
        ) {
          terminalClient.socket.send(chunk);
        }
      }
    });
    runtime.on("attach", (session) => {
      verboseLog("runtime attached session", context.clientId, slot.slot, session);
    });
    runtime.on("exit", (code) => {
      logger.log(`tmux PTY exited with code ${code} (${context.clientId} slot ${slot.slot})`);
      sendJson(context.socket, {
        type: "info",
        message: `tmux client exited (slot ${slot.slot})`
      });
    });
    slot.runtime = runtime;
    return runtime;
  };

  const attachControlToBaseSession = async (
    context: ControlContext,
    baseSession: string,
    slot: SlotContext
  ): Promise<void> => {
    // ADR-0013 §7: same base session can't be attached to two slots in the
    // same client. tmux supports it (grouped clients) but the layout
    // semantics don't. Reject early so the frontend toast surfaces it.
    for (const other of context.slots.values()) {
      if (other.slot === slot.slot) continue;
      if (other.baseSession === baseSession) {
        throw new Error(`session "${baseSession}" is already attached to slot ${other.slot}`);
      }
    }
    const runtime = getOrCreateRuntime(context, slot);
    const mobileSession = buildClientSessionName(context.clientId, slot.slot);
    const sessions = await deps.tmux.listSessions();
    const hasMobileSession = sessions.some((session) => session.name === mobileSession);
    const needsRecreate = hasMobileSession && slot.baseSession && slot.baseSession !== baseSession;

    if (needsRecreate) {
      await deps.tmux.killSession(mobileSession);
    }
    if (!hasMobileSession || needsRecreate) {
      await deps.tmux.createGroupedSession(mobileSession, baseSession);
    }

    slot.baseSession = baseSession;
    slot.attachedSession = mobileSession;
    runtime.attachToSession(mobileSession, slot.initialDimensions);
    sendJson(context.socket, {
      type: "attached",
      session: mobileSession,
      baseSession,
      slot: slot.slot
    });
    await seedScrollback(context, baseSession, slot);
  };

  const resolveActivePane = async (session: string): Promise<{ id: string } | null> => {
    const windows = await deps.tmux.listWindows(session);
    const activeWindow = windows.find((w) => w.active) ?? windows[0];
    if (!activeWindow) return null;
    const panes = await deps.tmux.listPanes(session, activeWindow.index);
    const activePane = panes.find((p) => p.active) ?? panes[0];
    return activePane ? { id: activePane.id } : null;
  };

  const seedScrollback = async (
    context: ControlContext,
    baseSession: string,
    slot: SlotContext
  ): Promise<void> => {
    try {
      const pane = await resolveActivePane(baseSession);
      if (!pane) return;
      const text = await deps.tmux.capturePane(pane.id, SEED_HISTORY_LINES, true, false);
      sendJson(context.socket, {
        type: "scrollback",
        paneId: pane.id,
        lines: SEED_HISTORY_LINES,
        text,
        slot: slot.slot
      });
    } catch (error) {
      logger.error("seedScrollback failed", baseSession, "slot", slot.slot, error);
    }
  };

  const ensureAttachedSession = async (
    context: ControlContext,
    slot: SlotContext,
    forceSession?: string
  ): Promise<void> => {
    if (forceSession) {
      logger.log("attach session (forced)", forceSession, "slot", slot.slot);
      await attachControlToBaseSession(context, forceSession, slot);
      return;
    }

    // Slots > 0 never auto-attach — they wait for an explicit select_session
    // from the empty-slot picker (frontend ADR-0013 §4). Sending session_picker
    // here would race the auto-pick path; the picker UI for slots > 0 owns
    // its own list via tmux_state snapshots.
    if (slot.slot !== 0) {
      return;
    }

    const sessions = (await deps.tmux.listSessions()).filter(
      (session) => !isManagedClientSession(session.name)
    );
    logger.log(
      "sessions discovered",
      sessions
        .map((session) => `${session.name}:${session.attached ? "attached" : "detached"}`)
        .join(",")
    );
    if (sessions.length === 0) {
      await deps.tmux.createSession(config.defaultSession);
      logger.log("created default session", config.defaultSession);
      await attachControlToBaseSession(context, config.defaultSession, slot);
      return;
    }

    if (sessions.length === 1) {
      logger.log("attach only session", sessions[0].name);
      await attachControlToBaseSession(context, sessions[0].name, slot);
      return;
    }

    logger.log("show session picker", sessions.length);
    sendJson(context.socket, { type: "session_picker", sessions });
  };

  const runControlMutation = async (
    message: ControlClientMessage,
    context: ControlContext
  ): Promise<void> => {
    const slot = ensureSlot(context, messageSlot(message));
    const attachedSession = slot.attachedSession;

    switch (message.type) {
      case "select_session":
        await attachControlToBaseSession(context, message.session, slot);
        return;
      case "new_session":
        await deps.tmux.createSession(message.name, {
          cwd: message.cwd,
          startupCommand: message.startupCommand
        });
        await attachControlToBaseSession(context, message.name, slot);
        return;
      case "rename_session":
        await deps.tmux.renameSession(message.session, message.newName);
        // Iterate ALL slots: every slot mirroring this base needs an updated
        // attached message so the frontend sees the new name.
        for (const s of context.slots.values()) {
          if (s.baseSession === message.session) {
            s.baseSession = message.newName;
            sendJson(context.socket, {
              type: "attached",
              session: s.attachedSession ?? "",
              baseSession: message.newName,
              slot: s.slot
            });
          }
        }
        return;
      case "rename_window":
        await deps.tmux.renameWindow(message.session, message.windowIndex, message.newName);
        return;
      case "kill_session": {
        // Find any slot mirroring the killed base — at most one given the
        // "no duplicate attach" rule (ADR-0013 §7).
        const affectedSlot = Array.from(context.slots.values()).find(
          (s) => s.baseSession === message.session
        );
        await deps.tmux.killSession(message.session);
        if (affectedSlot) {
          affectedSlot.baseSession = undefined;
          if (affectedSlot.attachedSession) {
            try {
              await deps.tmux.killSession(affectedSlot.attachedSession);
            } catch {
              // Already gone — tmux collapses the grouped session when its
              // base dies.
            }
            affectedSlot.attachedSession = undefined;
          }
          affectedSlot.runtime?.shutdown();
          affectedSlot.runtime = undefined;
          affectedSlot.attachStarted = false;
          // Slot 0 reattaches to whatever's left (or auto-creates default);
          // higher slots stay empty until the user picks again.
          if (affectedSlot.slot === 0) {
            affectedSlot.attachStarted = true;
            await ensureAttachedSession(context, affectedSlot);
          }
        }
        return;
      }
      case "new_window":
        if (!attachedSession) {
          throw new Error("no attached session");
        }
        await deps.tmux.newWindow(attachedSession);
        return;
      case "select_window":
        if (!attachedSession) {
          throw new Error("no attached session");
        }
        await deps.tmux.selectWindow(attachedSession, message.windowIndex);
        if (message.stickyZoom === true) {
          const panes = await deps.tmux.listPanes(attachedSession, message.windowIndex);
          const activePane = panes.find((pane) => pane.active) ?? panes[0];
          if (activePane && !(await deps.tmux.isPaneZoomed(activePane.id))) {
            await deps.tmux.zoomPane(activePane.id);
          }
        }
        return;
      case "kill_window":
        if (!attachedSession) {
          throw new Error("no attached session");
        }
        await deps.tmux.killWindow(attachedSession, message.windowIndex);
        return;
      case "select_pane":
        await deps.tmux.selectPane(message.paneId);
        if (message.stickyZoom === true && !(await deps.tmux.isPaneZoomed(message.paneId))) {
          await deps.tmux.zoomPane(message.paneId);
        }
        return;
      case "split_pane":
        await deps.tmux.splitWindow(message.paneId, message.orientation);
        return;
      case "kill_pane":
        await deps.tmux.killPane(message.paneId);
        return;
      case "zoom_pane":
        await deps.tmux.zoomPane(message.paneId);
        return;
      case "capture_scrollback": {
        const lines = message.lines ?? config.scrollbackLines;
        const includeEscapes = message.includeEscapes ?? true;
        const output = await deps.tmux.capturePane(message.paneId, lines, includeEscapes);
        sendJson(context.socket, {
          type: "scrollback",
          paneId: message.paneId,
          lines,
          text: output,
          slot: slot.slot
        });
        return;
      }
      case "send_compose":
        if (attachedSession) {
          await deps.tmux.sendKeys(attachedSession, message.text);
        }
        return;
      case "send_raw":
        slot.runtime?.write(message.bytes);
        return;
      case "detach_slot": {
        // Tear down the runtime + grouped session for this slot. The slot
        // shell stays in context.slots so terminalClients still in-flight
        // don't crash on lookup; their next reattach gets a fresh runtime.
        slot.runtime?.shutdown();
        slot.runtime = undefined;
        slot.attachStarted = false;
        if (slot.attachedSession) {
          try {
            await deps.tmux.killSession(slot.attachedSession);
          } catch {
            // Already gone — tmux collapses grouped clients when the base
            // dies, so this can race. Non-fatal.
          }
          slot.attachedSession = undefined;
        }
        slot.baseSession = undefined;
        return;
      }
      case "auth":
      case "resync_state":
        // Handled in the auth-gated message loop before runControlMutation.
        return;
      case "terminal_ready":
        // Handled in the auth-gated message loop before runControlMutation.
        return;
      default: {
        const _: never = message;
        return _;
      }
    }
  };

  const shutdownControlContext = async (context: ControlContext): Promise<void> => {
    for (const slot of context.slots.values()) {
      for (const terminalClient of slot.terminalClients) {
        if (terminalClient.socket.readyState === terminalClient.socket.OPEN) {
          terminalClient.socket.close();
        }
      }
      slot.terminalClients.clear();
      slot.runtime?.shutdown();
      slot.runtime = undefined;
    }
    if (context.socket.readyState === context.socket.OPEN) {
      context.socket.close();
    }
    for (const slot of context.slots.values()) {
      if (slot.attachedSession) {
        try {
          await deps.tmux.killSession(slot.attachedSession);
        } catch (error) {
          logger.error(
            "failed to cleanup mobile session",
            slot.attachedSession,
            "slot",
            slot.slot,
            error
          );
        }
        slot.attachedSession = undefined;
      }
    }
    context.slots.clear();
  };

  controlWss.on("connection", (socket) => {
    const context: ControlContext = {
      socket,
      authed: false,
      clientId: randomToken(12),
      slots: new Map<SlotId, SlotContext>(),
      stateDelta: false,
      lastSentState: undefined,
      stateVersion: 0
    };
    controlClients.add(context);
    logger.log("control ws connected", context.clientId);

    socket.on("message", async (rawData) => {
      const message = parseClientMessage(rawData.toString("utf8"));
      if (!message) {
        sendJson(socket, { type: "error", message: "invalid message format" });
        return;
      }
      logger.log("control ws message", context.clientId, message.type);
      verboseLog("control ws payload", context.clientId, summarizeClientMessage(message));

      try {
        if (!context.authed) {
          if (message.type !== "auth") {
            sendJson(socket, { type: "auth_error", reason: "auth required" });
            return;
          }

          const authResult = authService.verify({
            token: message.token,
            password: message.password
          });
          if (!authResult.ok) {
            logger.log("control ws auth failed", context.clientId, authResult.reason ?? "unknown");
            sendJson(socket, {
              type: "auth_error",
              reason: authResult.reason ?? "unauthorized"
            });
            return;
          }

          context.authed = true;
          // ADR-0015 §2: opt in to JSON Patch broadcasts when the client
          // advertises the capability. Unknown / false / absent → legacy
          // full-state broadcasts for this client.
          context.stateDelta = message.capabilities?.stateDelta === true;
          logger.log("control ws auth ok", context.clientId, `stateDelta=${context.stateDelta}`);
          sendJson(socket, {
            type: "auth_ok",
            clientId: context.clientId,
            requiresPassword: authService.requiresPassword()
          });
          sendSysinfoGreeting(context);
          await monitor?.forcePublish();
          return;
        }

        if (message.type === "resync_state") {
          // ADR-0015 §2: client detected a version gap and asked for a
          // fresh anchor. Clear its last-sent snapshot so the next broadcast
          // is a full state, then force one now.
          context.lastSentState = undefined;
          await monitor?.forcePublish();
          return;
        }

        if (message.type === "terminal_ready") {
          const cols = Math.floor(message.cols);
          const rows = Math.floor(message.rows);
          if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) {
            sendJson(socket, {
              type: "error",
              message: "terminal_ready requires positive cols/rows"
            });
            return;
          }
          const slot = ensureSlot(context, messageSlot(message));
          slot.initialDimensions = { cols, rows };
          if (slot.runtime) {
            slot.runtime.resize(cols, rows);
          }
          // Slot 0 auto-attaches on first ready (preserves single-pane bootstrap).
          // Higher slots wait for an explicit select_session from the picker.
          if (slot.slot === 0 && !slot.attachStarted) {
            slot.attachStarted = true;
            try {
              await ensureAttachedSession(context, slot);
            } catch (error) {
              logger.error("initial attach failed", error);
              sendJson(socket, {
                type: "error",
                message: error instanceof Error ? error.message : String(error)
              });
              slot.attachStarted = false;
            }
          }
          await monitor?.forcePublish();
          return;
        }

        try {
          verboseLog("control mutation start", context.clientId, message.type);
          await runControlMutation(message, context);
          verboseLog("control mutation done", context.clientId, message.type);
        } finally {
          verboseLog("force publish start", context.clientId, message.type);
          await monitor?.forcePublish();
          verboseLog("force publish done", context.clientId, message.type);
        }
      } catch (error) {
        logger.error("control ws error", context.clientId, error);
        sendJson(socket, {
          type: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    socket.on("close", () => {
      controlClients.delete(context);
      void shutdownControlContext(context);
      logger.log("control ws closed", context.clientId);
    });
  });

  terminalWss.on("connection", (socket) => {
    const ctx: DataContext = { socket, authed: false, slot: 0 };
    terminalClients.add(ctx);
    logger.log("terminal ws connected");

    socket.on("message", (rawData, isBinary) => {
      if (!ctx.authed) {
        if (isBinary) {
          socket.close(4001, "auth required");
          return;
        }

        const authMessage = parseClientMessage(rawData.toString("utf8"));
        if (!authMessage || authMessage.type !== "auth") {
          socket.close(4001, "auth required");
          return;
        }
        const clientId = authMessage.clientId;
        if (!clientId) {
          socket.close(4001, "unauthorized");
          return;
        }

        const authResult = authService.verify({
          token: authMessage.token,
          password: authMessage.password
        });
        if (!authResult.ok) {
          logger.log("terminal ws auth failed", authResult.reason ?? "unknown");
          socket.close(4001, "unauthorized");
          return;
        }
        const controlContext = getControlContext(clientId);
        if (!controlContext || !controlContext.authed) {
          socket.close(4001, "unauthorized");
          return;
        }

        // The terminal-WS auth payload carries the slot it speaks for. Old
        // clients without `slot` get slot 0 (single-pane behaviour).
        const slotId = normalizeSlot((authMessage as { slot?: unknown }).slot);
        const slot = ensureSlot(controlContext, slotId);

        ctx.authed = true;
        ctx.controlClientId = clientId;
        ctx.controlContext = controlContext;
        ctx.slot = slotId;
        slot.terminalClients.add(ctx);
        logger.log("terminal ws auth ok", "slot", slotId);
        return;
      }

      const slot = ctx.controlContext?.slots.get(ctx.slot);

      if (isBinary) {
        const binaryBytes =
          typeof rawData === "string"
            ? Buffer.byteLength(rawData, "utf8")
            : rawData instanceof ArrayBuffer
              ? rawData.byteLength
              : Array.isArray(rawData)
                ? rawData.reduce((sum, chunk) => sum + chunk.length, 0)
                : rawData.length;
        verboseLog("terminal ws binary input", `slot=${ctx.slot}`, `bytes=${binaryBytes}`);
        slot?.runtime?.write(rawData.toString());
        return;
      }

      const text = rawData.toString("utf8");
      if (text.startsWith("{")) {
        try {
          const payload = JSON.parse(text) as unknown;
          if (
            isObject(payload) &&
            payload.type === "resize" &&
            typeof payload.cols === "number" &&
            typeof payload.rows === "number"
          ) {
            slot?.runtime?.resize(payload.cols, payload.rows);
            verboseLog("terminal ws resize", `slot=${ctx.slot}`, `${payload.cols}x${payload.rows}`);
            return;
          }
        } catch {
          // fall through and treat as terminal input
        }
      }

      slot?.runtime?.write(text);
      verboseLog(
        "terminal ws text input",
        `slot=${ctx.slot}`,
        `bytes=${Buffer.byteLength(text, "utf8")}`
      );
    });

    socket.on("close", () => {
      terminalClients.delete(ctx);
      const slot = ctx.controlContext?.slots.get(ctx.slot);
      slot?.terminalClients.delete(ctx);
      logger.log("terminal ws closed", "slot", ctx.slot);
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === `${basePath}/ws/control`) {
      controlWss.handleUpgrade(request, socket, head, (websocket) => {
        controlWss.emit("connection", websocket, request);
      });
      return;
    }

    if (url.pathname === `${basePath}/ws/terminal`) {
      terminalWss.handleUpgrade(request, socket, head, (websocket) => {
        terminalWss.emit("connection", websocket, request);
      });
      return;
    }

    socket.destroy();
  });

  return {
    config,
    server,
    async start() {
      if (started) {
        return;
      }
      logger.log("server start requested", `${config.host}:${config.port}`);
      monitor = new TmuxStateMonitor(deps.tmux, config.pollIntervalMs, broadcastState, (error) =>
        logger.error(error)
      );
      await monitor.start();

      sysinfo = new SysinfoSampler({
        intervalMs: 2000,
        onSample: () => broadcastSysinfoSample(),
        onUnsupported: (reason) => {
          sysinfoUnsupported = true;
          logger.log("sysinfo sampler disabled:", reason);
        },
        onError: (error) => logger.error("sysinfo tick failed", error)
      });
      await sysinfo.start();
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off("error", onError);
          reject(error);
        };

        server.once("error", onError);
        server.listen(config.port, config.host, () => {
          server.off("error", onError);
          started = true;
          logger.log(
            "server listening",
            `${config.host}:${(server.address() as { port: number }).port}`
          );
          resolve();
        });
      });
    },
    async stop() {
      if (!started) {
        return;
      }
      if (stopPromise) {
        await stopPromise;
        return;
      }

      stopPromise = (async () => {
        logger.log("server shutdown begin");
        monitor?.stop();
        sysinfo?.stop();
        await Promise.all(
          Array.from(controlClients).map((context) => shutdownControlContext(context))
        );
        controlWss.close();
        terminalWss.close();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
        logger.log("server shutdown complete");
      })();

      try {
        await stopPromise;
      } finally {
        started = false;
        stopPromise = null;
      }
    }
  };
};

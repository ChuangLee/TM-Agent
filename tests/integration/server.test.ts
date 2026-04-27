import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket, type RawData } from "ws";
import { AuthService } from "../../src/backend/auth/auth-service.js";
import type { RuntimeConfig } from "../../src/backend/config.js";
import { createTMAgentServer, type RunningServer } from "../../src/backend/server.js";
import { buildSnapshot } from "../../src/backend/tmux/types.js";
import { FakePtyFactory } from "../harness/fakePty.js";
import { FakeTmuxGateway } from "../harness/fakeTmux.js";
import { openSocket, waitForMessage } from "../harness/ws.js";

const buildConfig = (token: string): RuntimeConfig => ({
  port: 0,
  host: "127.0.0.1",
  password: undefined,
  defaultSession: "main",
  scrollbackLines: 1000,
  pollIntervalMs: 100,
  token,
  frontendDir: process.cwd(),
  filesMaxUploadBytes: 100 * 1024 * 1024,
  workspaceRoot: process.cwd()
});

describe("TM-Agent server", () => {
  let runningServer: RunningServer;
  let tmux: FakeTmuxGateway;
  let ptyFactory: FakePtyFactory;
  let baseWsUrl: string;
  let baseHttpUrl: string;

  const authControl = async (
    control: WebSocket,
    token: string = "test-token",
    dims: { cols: number; rows: number } = { cols: 120, rows: 40 }
  ): Promise<{ clientId: string; attachedSession: string }> => {
    const authOkPromise = waitForMessage<{ type: string; clientId: string }>(
      control,
      (msg) => msg.type === "auth_ok"
    );
    const attachedPromise = waitForMessage<{ type: string; session: string }>(
      control,
      (msg) => msg.type === "attached"
    );
    control.send(JSON.stringify({ type: "auth", token }));
    const authOk = await authOkPromise;
    // Attach is gated on terminal_ready so tmux sees the real pane geometry.
    control.send(JSON.stringify({ type: "terminal_ready", cols: dims.cols, rows: dims.rows }));
    const attached = await attachedPromise;
    return { clientId: authOk.clientId, attachedSession: attached.session };
  };

  const waitForTmuxCall = async (
    predicate: (call: string) => boolean,
    timeoutMs = 1_000
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (tmux.calls.some(predicate)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("timed out waiting for expected tmux call");
  };

  const startWithSessions = async (
    sessions: string[],
    options: { password?: string; attachedSession?: string; failSwitchClient?: boolean } = {}
  ): Promise<void> => {
    tmux = new FakeTmuxGateway(sessions, {
      attachedSession: options.attachedSession,
      failSwitchClient: options.failSwitchClient
    });
    ptyFactory = new FakePtyFactory();
    const auth = new AuthService(options.password, "test-token");

    runningServer = createTMAgentServer(buildConfig("test-token"), {
      tmux,
      ptyFactory,
      authService: auth,
      logger: { log: () => undefined, error: () => undefined }
    });

    await runningServer.start();
    const address = runningServer.server.address() as AddressInfo;
    baseWsUrl = `ws://127.0.0.1:${address.port}`;
    baseHttpUrl = `http://127.0.0.1:${address.port}`;
  };

  beforeEach(async () => {
    await startWithSessions([]);
  });

  afterEach(async () => {
    await runningServer.stop();
  });

  test("rejects invalid token", async () => {
    const control = await openSocket(`${baseWsUrl}/ws/control`);
    control.send(JSON.stringify({ type: "auth", token: "bad-token" }));

    const response = await waitForMessage<{ type: string; reason?: string }>(
      control,
      (msg) => msg.type === "auth_error"
    );
    expect(response.reason).toContain("invalid token");

    control.close();
  });

  test("issues HttpOnly password session cookie for subsequent websocket auth", async () => {
    await runningServer.stop();
    await startWithSessions(["main"], { password: "pw" });

    const login = await fetch(`${baseHttpUrl}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "test-token", password: "pw" })
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("tm_agent_session=");
    expect(cookie).toContain("HttpOnly");

    const control = new WebSocket(`${baseWsUrl}/ws/control`, {
      headers: { cookie: cookie.split(";")[0] ?? "" }
    });
    await new Promise<void>((resolve, reject) => {
      control.once("open", resolve);
      control.once("error", reject);
    });
    control.send(JSON.stringify({ type: "auth", token: "test-token" }));

    const response = await waitForMessage<{ type: string }>(
      control,
      (msg) => msg.type === "auth_ok"
    );
    expect(response.type).toBe("auth_ok");
    control.close();
  });

  test("creates default session and attaches when no sessions exist", async () => {
    const control = await openSocket(`${baseWsUrl}/ws/control`);
    const { attachedSession } = await authControl(control);

    expect(attachedSession).toMatch(/^tm-agent-client-/);
    expect(tmux.calls).toContain("createSession:main");
    expect(tmux.calls).toContain(`createGroupedSession:${attachedSession}:main`);
    expect(ptyFactory.lastSpawnedSession).toBe(attachedSession);

    control.close();
  });

  test("shows session picker when multiple sessions exist", async () => {
    await runningServer.stop();
    await startWithSessions(["work", "dev"]);

    const control = await openSocket(`${baseWsUrl}/ws/control`);
    control.send(JSON.stringify({ type: "auth", token: "test-token" }));
    await waitForMessage(control, (msg: { type: string }) => msg.type === "auth_ok");
    control.send(JSON.stringify({ type: "terminal_ready", cols: 120, rows: 40 }));

    const picker = await waitForMessage<{ type: string; sessions: Array<{ name: string }> }>(
      control,
      (msg) => msg.type === "session_picker"
    );

    expect(picker.sessions).toHaveLength(2);
    control.close();
  });

  test("shows session picker even when one session is currently attached", async () => {
    await runningServer.stop();
    await startWithSessions(["main", "work"], { attachedSession: "work" });

    const control = await openSocket(`${baseWsUrl}/ws/control`);
    control.send(JSON.stringify({ type: "auth", token: "test-token" }));
    await waitForMessage(control, (msg: { type: string }) => msg.type === "auth_ok");
    control.send(JSON.stringify({ type: "terminal_ready", cols: 120, rows: 40 }));

    const picker = await waitForMessage<{ type: string; sessions: Array<{ name: string }> }>(
      control,
      (msg) => msg.type === "session_picker"
    );

    expect(picker.sessions).toHaveLength(2);
    expect(ptyFactory.lastSpawnedSession).toBeUndefined();
    control.close();
  });

  test("select_session attaches without using switch-client", async () => {
    await runningServer.stop();
    await startWithSessions(["work", "dev"], { failSwitchClient: true });

    const control = await openSocket(`${baseWsUrl}/ws/control`);
    control.send(JSON.stringify({ type: "auth", token: "test-token" }));
    await waitForMessage(control, (msg: { type: string }) => msg.type === "auth_ok");
    control.send(JSON.stringify({ type: "terminal_ready", cols: 120, rows: 40 }));
    await waitForMessage(control, (msg: { type: string }) => msg.type === "session_picker");

    control.send(JSON.stringify({ type: "select_session", session: "dev" }));
    const attached = await waitForMessage<{
      type: string;
      session: string;
      baseSession: string;
    }>(control, (msg) => msg.type === "attached");

    expect(attached.session).toMatch(/^tm-agent-client-/);
    expect(attached.baseSession).toBe("dev");
    expect(tmux.calls).toContain(`createGroupedSession:${attached.session}:dev`);
    expect(ptyFactory.lastSpawnedSession).toBe(attached.session);
    expect(tmux.calls.some((call) => call.startsWith("switchClient:"))).toBe(false);
    control.close();
  });

  test("requires terminal auth to bind to an authenticated control client", async () => {
    const control = await openSocket(`${baseWsUrl}/ws/control`);
    await authControl(control);

    const terminal = await openSocket(`${baseWsUrl}/ws/terminal`);
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      terminal.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") }));
    });
    terminal.send(JSON.stringify({ type: "auth", token: "test-token" }));

    await expect(closed).resolves.toMatchObject({ code: 4001, reason: "unauthorized" });
    control.close();
  });

  test("isolates terminal runtime per authenticated control client", async () => {
    await runningServer.stop();
    await startWithSessions(["main"]);

    const controlA = await openSocket(`${baseWsUrl}/ws/control`);
    const authA = await authControl(controlA);
    const controlB = await openSocket(`${baseWsUrl}/ws/control`);
    const authB = await authControl(controlB);

    expect(ptyFactory.processes).toHaveLength(2);

    const terminalA = await openSocket(`${baseWsUrl}/ws/terminal`);
    terminalA.send(JSON.stringify({ type: "auth", token: "test-token", clientId: authA.clientId }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const terminalB = await openSocket(`${baseWsUrl}/ws/terminal`);
    terminalB.send(JSON.stringify({ type: "auth", token: "test-token", clientId: authB.clientId }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const fromA = new Promise<string>((resolve) => {
      terminalA.once("message", (raw: RawData) => resolve(raw.toString("utf8")));
    });
    ptyFactory.processes[0].emitData("from-a");
    await expect(fromA).resolves.toBe("from-a");

    const fromB = new Promise<string>((resolve) => {
      terminalB.once("message", (raw: RawData) => resolve(raw.toString("utf8")));
    });
    ptyFactory.processes[1].emitData("from-b");
    await expect(fromB).resolves.toBe("from-b");

    terminalA.send("input-a");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ptyFactory.processes[0].writes).toContain("input-a");
    expect(ptyFactory.processes[1].writes).not.toContain("input-a");

    terminalA.close();
    terminalB.close();
    controlA.close();
    controlB.close();
  });

  test("executes control commands and forwards terminal io", async () => {
    await runningServer.stop();
    await startWithSessions(["main"]);

    const control = await openSocket(`${baseWsUrl}/ws/control`);
    const { clientId, attachedSession } = await authControl(control);
    const snapshot = await buildSnapshot(tmux);
    const attachedState = snapshot.sessions.find((session) => session.name === attachedSession);
    expect(attachedState).toBeDefined();
    const paneId = attachedState?.windowStates[0].panes[0].id ?? "";

    control.send(JSON.stringify({ type: "split_pane", paneId, orientation: "h" }));
    control.send(JSON.stringify({ type: "send_compose", text: "echo hi" }));
    const capturePromise = waitForMessage<{ type: string; text: string }>(
      control,
      (msg) => msg.type === "scrollback"
    );
    control.send(JSON.stringify({ type: "capture_scrollback", paneId, lines: 222 }));

    const capture = await capturePromise;
    expect(capture.text).toContain("captured 222 lines");
    expect(tmux.calls).toContain(`splitWindow:${paneId}:h`);
    expect(tmux.calls).toContain(`sendKeys:${attachedSession}:echo hi`);

    const terminal = await openSocket(`${baseWsUrl}/ws/terminal`);
    terminal.send(JSON.stringify({ type: "auth", token: "test-token", clientId }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const terminalDataPromise = new Promise<string>((resolve) => {
      terminal.once("message", (raw: RawData) => resolve(raw.toString("utf8")));
    });
    ptyFactory.latestProcess().emitData("tmux-output");
    const terminalData = await terminalDataPromise;
    expect(terminalData).toBe("tmux-output");

    terminal.send("input-data");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ptyFactory.latestProcess().writes).toContain("input-data");

    terminal.close();
    control.close();
  });

  test("select_pane with stickyZoom calls both selectPane and zoomPane", async () => {
    await runningServer.stop();
    await startWithSessions(["main"]);

    const control = await openSocket(`${baseWsUrl}/ws/control`);
    control.send(JSON.stringify({ type: "auth", token: "test-token" }));
    await waitForMessage(control, (msg: { type: string }) => msg.type === "auth_ok");
    control.send(JSON.stringify({ type: "terminal_ready", cols: 120, rows: 40 }));
    await waitForMessage(control, (msg: { type: string }) => msg.type === "attached");

    const snapshot = await buildSnapshot(tmux);
    const paneId = snapshot.sessions[0].windowStates[0].panes[0].id;

    // Split to create a second pane
    control.send(JSON.stringify({ type: "split_pane", paneId, orientation: "h" }));
    await waitForTmuxCall((call) => call === `splitWindow:${paneId}:h`);

    const updatedSnapshot = await buildSnapshot(tmux);
    const secondPaneId = updatedSnapshot.sessions[0].windowStates[0].panes[1].id;

    // Clear calls to isolate the select_pane + stickyZoom behavior
    tmux.calls.length = 0;

    // Select the first pane with stickyZoom enabled
    control.send(JSON.stringify({ type: "select_pane", paneId, stickyZoom: true }));
    await waitForTmuxCall((call) => call === `zoomPane:${paneId}`);

    expect(tmux.calls).toContain(`selectPane:${paneId}`);
    expect(tmux.calls).toContain(`zoomPane:${paneId}`);

    // Clear and verify without stickyZoom
    tmux.calls.length = 0;
    control.send(JSON.stringify({ type: "select_pane", paneId: secondPaneId }));
    await waitForTmuxCall((call) => call === `selectPane:${secondPaneId}`);

    expect(tmux.calls).toContain(`selectPane:${secondPaneId}`);
    expect(tmux.calls).not.toContain(`zoomPane:${secondPaneId}`);

    control.close();
  });

  test("select_pane with stickyZoom does not toggle zoom when window is already zoomed", async () => {
    await runningServer.stop();
    await startWithSessions(["main"]);

    const control = await openSocket(`${baseWsUrl}/ws/control`);
    control.send(JSON.stringify({ type: "auth", token: "test-token" }));
    await waitForMessage(control, (msg: { type: string }) => msg.type === "auth_ok");
    control.send(JSON.stringify({ type: "terminal_ready", cols: 120, rows: 40 }));
    await waitForMessage(control, (msg: { type: string }) => msg.type === "attached");

    const snapshot = await buildSnapshot(tmux);
    const paneId = snapshot.sessions[0].windowStates[0].panes[0].id;

    // Split to create a second pane
    control.send(JSON.stringify({ type: "split_pane", paneId, orientation: "h" }));
    await waitForTmuxCall((call) => call === `splitWindow:${paneId}:h`);

    const updatedSnapshot = await buildSnapshot(tmux);
    const secondPaneId = updatedSnapshot.sessions[0].windowStates[0].panes[1].id;

    // Pre-zoom the window
    control.send(JSON.stringify({ type: "zoom_pane", paneId }));
    await waitForTmuxCall((call) => call === `zoomPane:${paneId}`);

    // Clear calls to isolate stickyZoom select behavior
    tmux.calls.length = 0;

    control.send(JSON.stringify({ type: "select_pane", paneId: secondPaneId, stickyZoom: true }));
    await waitForTmuxCall((call) => call === `selectPane:${secondPaneId}`);

    expect(tmux.calls).toContain(`selectPane:${secondPaneId}`);
    expect(tmux.calls).not.toContain(`zoomPane:${secondPaneId}`);

    control.close();
  });

  test("select_window with stickyZoom zooms the target window active pane", async () => {
    await runningServer.stop();
    await startWithSessions(["main"]);

    const control = await openSocket(`${baseWsUrl}/ws/control`);
    const { attachedSession } = await authControl(control);

    control.send(JSON.stringify({ type: "new_window", session: attachedSession }));
    await waitForTmuxCall((call) => call === `newWindow:${attachedSession}`);

    tmux.calls.length = 0;

    control.send(
      JSON.stringify({
        type: "select_window",
        session: attachedSession,
        windowIndex: 0,
        stickyZoom: true
      })
    );
    await waitForTmuxCall((call) => call === `selectWindow:${attachedSession}:0`);

    expect(tmux.calls).toContain(`selectWindow:${attachedSession}:0`);
    expect(tmux.calls.some((call) => call.startsWith("zoomPane:"))).toBe(true);

    control.close();
  });

  test("rename_session delegates to tmux and updates attached base name", async () => {
    await runningServer.stop();
    await startWithSessions(["main"]);

    const control = await openSocket(`${baseWsUrl}/ws/control`);
    await authControl(control);

    const renamedAttachedPromise = waitForMessage<{
      type: string;
      baseSession: string;
    }>(control, (msg) => msg.type === "attached" && msg.baseSession === "work");

    control.send(
      JSON.stringify({
        type: "rename_session",
        session: "main",
        newName: "work"
      })
    );

    await waitForTmuxCall((call) => call === "renameSession:main:work");
    const attached = await renamedAttachedPromise;
    expect(attached.baseSession).toBe("work");

    control.close();
  });

  test("rename_window delegates to tmux", async () => {
    await runningServer.stop();
    await startWithSessions(["main"]);

    const control = await openSocket(`${baseWsUrl}/ws/control`);
    await authControl(control);

    control.send(
      JSON.stringify({
        type: "rename_window",
        session: "main",
        windowIndex: 0,
        newName: "editor"
      })
    );

    await waitForTmuxCall((call) => call === "renameWindow:main:0:editor");
    control.close();
  });

  test("kill_session of a non-attached peer delegates to tmux", async () => {
    await runningServer.stop();
    await startWithSessions(["main", "work"]);

    const control = await openSocket(`${baseWsUrl}/ws/control`);
    // With 2 base sessions the backend sends `session_picker` instead of
    // auto-attaching — respond with a select_session to pick "main" so the
    // attach handshake completes before we test the kill path.
    const authOkPromise = waitForMessage<{ type: string }>(
      control,
      (msg) => msg.type === "auth_ok"
    );
    control.send(JSON.stringify({ type: "auth", token: "test-token" }));
    await authOkPromise;
    const pickerPromise = waitForMessage<{ type: string }>(
      control,
      (msg) => msg.type === "session_picker"
    );
    control.send(JSON.stringify({ type: "terminal_ready", cols: 120, rows: 40 }));
    await pickerPromise;
    const attachedPromise = waitForMessage<{ type: string }>(
      control,
      (msg) => msg.type === "attached"
    );
    control.send(JSON.stringify({ type: "select_session", session: "main" }));
    await attachedPromise;

    tmux.calls.length = 0;

    control.send(
      JSON.stringify({
        type: "kill_session",
        session: "work"
      })
    );

    await waitForTmuxCall((call) => call === "killSession:work");
    // No follow-up re-attach should fire — we weren't on work.
    expect(tmux.calls.filter((c) => c.startsWith("createGroupedSession:")).length).toBe(0);

    control.close();
  });

  test("stop is idempotent when called repeatedly", async () => {
    await runningServer.stop();
    await runningServer.stop();
  });

  // ADR-0015 §2 — JSON Patch delta broadcasts gated on client capability.
  describe("tmux_state delta (ADR-0015)", () => {
    test("legacy client (no capability) receives only full tmux_state", async () => {
      await runningServer.stop();
      await startWithSessions(["main"]);

      const control = await openSocket(`${baseWsUrl}/ws/control`);
      const { attachedSession } = await authControl(control);

      const seen: string[] = [];
      control.on("message", (raw: RawData) => {
        try {
          const msg = JSON.parse(String(raw)) as { type: string };
          if (msg.type === "tmux_state" || msg.type === "tmux_state_delta") {
            seen.push(msg.type);
          }
        } catch {
          // ignore
        }
      });

      control.send(JSON.stringify({ type: "new_window", session: attachedSession }));
      await waitForTmuxCall((call) => call === `newWindow:${attachedSession}`);
      await new Promise((r) => setTimeout(r, 150));

      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((t) => t === "tmux_state")).toBe(true);
      control.close();
    });

    test("delta-capable client: full snapshot → delta; versions monotonic", async () => {
      await runningServer.stop();
      await startWithSessions(["main"]);

      const control = await openSocket(`${baseWsUrl}/ws/control`);

      const authOkPromise = waitForMessage<{ type: string; clientId: string }>(
        control,
        (msg) => msg.type === "auth_ok"
      );
      const attachedPromise = waitForMessage<{ type: string; session: string }>(
        control,
        (msg) => msg.type === "attached"
      );
      control.send(
        JSON.stringify({
          type: "auth",
          token: "test-token",
          capabilities: { stateDelta: true }
        })
      );
      await authOkPromise;
      control.send(JSON.stringify({ type: "terminal_ready", cols: 120, rows: 40 }));
      const attached = await attachedPromise;
      const attachedSession = attached.session;

      const frames: Array<{ type: string; version?: number; baseVersion?: number }> = [];
      control.on("message", (raw: RawData) => {
        try {
          const msg = JSON.parse(String(raw)) as {
            type: string;
            version?: number;
            baseVersion?: number;
          };
          if (msg.type === "tmux_state" || msg.type === "tmux_state_delta") {
            frames.push(msg);
          }
        } catch {
          // ignore
        }
      });

      control.send(JSON.stringify({ type: "new_window", session: attachedSession }));
      await waitForTmuxCall((call) => call === `newWindow:${attachedSession}`);
      await new Promise((r) => setTimeout(r, 150));

      tmux.calls.length = 0;
      control.send(
        JSON.stringify({
          type: "rename_window",
          session: attachedSession,
          windowIndex: 0,
          newName: "edit"
        })
      );
      await waitForTmuxCall((call) => call.startsWith("renameWindow:"));
      await new Promise((r) => setTimeout(r, 150));

      const firstFull = frames.find((f) => f.type === "tmux_state");
      const firstDelta = frames.find((f) => f.type === "tmux_state_delta");
      expect(firstFull).toBeDefined();
      expect(firstDelta).toBeDefined();
      for (let i = 1; i < frames.length; i++) {
        const prev = frames[i - 1]!;
        const curr = frames[i]!;
        expect(curr.version!).toBeGreaterThan(prev.version!);
        if (curr.type === "tmux_state_delta") {
          expect(curr.baseVersion).toBe(prev.version);
        }
      }
      control.close();
    });

    test("resync_state forces the server to resend a full tmux_state", async () => {
      await runningServer.stop();
      await startWithSessions(["main"]);

      const control = await openSocket(`${baseWsUrl}/ws/control`);
      const authOkPromise = waitForMessage<{ type: string }>(
        control,
        (msg) => msg.type === "auth_ok"
      );
      const attachedPromise = waitForMessage<{ type: string; session: string }>(
        control,
        (msg) => msg.type === "attached"
      );
      control.send(
        JSON.stringify({
          type: "auth",
          token: "test-token",
          capabilities: { stateDelta: true }
        })
      );
      await authOkPromise;
      control.send(JSON.stringify({ type: "terminal_ready", cols: 120, rows: 40 }));
      const attached = await attachedPromise;
      const attachedSession = attached.session;

      control.send(JSON.stringify({ type: "new_window", session: attachedSession }));
      await waitForTmuxCall((call) => call === `newWindow:${attachedSession}`);
      await new Promise((r) => setTimeout(r, 100));

      const nextFull = waitForMessage<{ type: string; version: number }>(
        control,
        (msg) => msg.type === "tmux_state"
      );
      control.send(JSON.stringify({ type: "resync_state" }));
      const full = await nextFull;
      expect(full.version).toBeGreaterThanOrEqual(1);

      control.close();
    });
  });
});

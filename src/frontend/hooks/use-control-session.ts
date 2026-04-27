import { useEffect, useRef } from "react";
import { applyPatch } from "fast-json-patch";
import { ControlWsClient, type ControlWsStatus } from "../services/control-ws.js";
import type {
  ControlClientMessage,
  ControlServerMessage,
  TmuxStateSnapshot
} from "../../shared/protocol.js";
import { debugLog } from "../lib/debug-log.js";
import { useAuthStore } from "../stores/auth-store.js";
import { useConnectionStore } from "../stores/connection-store.js";
import { useSessionsStore } from "../stores/sessions-store.js";
import { useSysinfoStore } from "../stores/sysinfo-store.js";
import { useTerminalStore } from "../stores/terminal-store.js";
import { useToastStore } from "../stores/toast-store.js";
import { useLayoutStore, type SlotId } from "../stores/layout-store.js";
import { useShellHistoryStore } from "../stores/shell-history-store.js";

const LAST_SESSION_KEY = "tm-agent:lastSession";

export function useControlSession(): {
  send: (message: ControlClientMessage) => void;
} {
  const token = useAuthStore((s) => s.token);
  const password = useAuthStore((s) => s.password);
  const phase = useAuthStore((s) => s.phase);
  const setPhase = useAuthStore((s) => s.setPhase);
  const setError = useAuthStore((s) => s.setError);
  const setClientId = useAuthStore((s) => s.setClientId);
  const setSnapshot = useSessionsStore((s) => s.setSnapshot);
  const setAttached = useSessionsStore((s) => s.setAttached);
  const setSeed = useTerminalStore((s) => s.setSeed);
  const setConnectionStatus = useConnectionStore((s) => s.setStatus);
  const reconnectTick = useConnectionStore((s) => s.reconnectTick);
  const ingestSysinfo = useSysinfoStore((s) => s.ingest);
  const markSysinfoUnsupported = useSysinfoStore((s) => s.markUnsupported);
  const pushToast = useToastStore((s) => s.push);

  const clientRef = useRef<ControlWsClient | null>(null);
  // ADR-0015 §2 delta state — per-connection version tracking + base snapshot
  // for JSON Patch applies. Reset on every WS lifecycle so a reconnect always
  // starts from a fresh full `tmux_state`.
  const stateBaseRef = useRef<TmuxStateSnapshot | null>(null);
  const stateVersionRef = useRef<number>(0);
  const shouldConnect = phase === "authenticating" || phase === "authed";

  useEffect(() => {
    if (!shouldConnect) return;
    if (clientRef.current) return;

    const onMessage = (msg: ControlServerMessage): void => {
      debugLog("ws", "control-recv", {
        type: msg.type,
        ...(msg.type === "attached" ? { session: msg.session } : {}),
        ...(msg.type === "scrollback" ? { paneId: msg.paneId, bytes: msg.text.length } : {}),
        ...(msg.type === "tmux_state" ? { sessionCount: msg.state.sessions.length } : {})
      });
      switch (msg.type) {
        case "auth_ok":
          setClientId(msg.clientId);
          setPhase("authed");
          // Tell SlotFrames the backend is fresh — drop their dedup state so
          // terminal_ready + select_session re-fire for the new server-side
          // ControlContext (which has no slot/runtime memory of us).
          useConnectionStore.getState().bumpAuthEpoch();
          void useShellHistoryStore.getState().ensureLoaded();
          return;
        case "auth_error":
          setError(msg.reason || "unauthorized");
          return;
        case "attached": {
          const slot = (msg.slot ?? 0) as SlotId;
          // Slot 0's attach is the "primary" surface — it drives the legacy
          // single-pane sessions-store fields (TopBar, Sidebar, etc.) and the
          // last-session memory. Higher slots only feed layout-store; the
          // global UI keeps reflecting slot 0.
          if (slot === 0) {
            setAttached(msg.session, msg.baseSession);
            try {
              localStorage.setItem(LAST_SESSION_KEY, msg.baseSession);
            } catch {
              // localStorage unavailable (private mode, quota) — non-fatal.
            }
          }
          useLayoutStore.getState().attachToSlot(slot, msg.baseSession);
          return;
        }
        case "session_picker": {
          // Multi-session: prefer the user's last choice from localStorage so
          // refreshing the tab keeps them on the same session. Falls back to
          // the first entry when there's no memory or the remembered session
          // no longer exists. The sidebar/drawer still lets them re-pick.
          let remembered: string | null = null;
          try {
            remembered = localStorage.getItem(LAST_SESSION_KEY);
          } catch {
            remembered = null;
          }
          const pick =
            (remembered && msg.sessions.find((s) => s.name === remembered)?.name) ??
            msg.sessions[0]?.name;
          if (pick) {
            clientRef.current?.send({
              type: "select_session",
              session: pick
            });
          }
          return;
        }
        case "tmux_state":
          stateBaseRef.current = msg.state;
          stateVersionRef.current = msg.version ?? 0;
          setSnapshot(msg.state);
          return;
        case "tmux_state_delta": {
          const base = stateBaseRef.current;
          if (!base || stateVersionRef.current !== msg.baseVersion) {
            // Version drift (missed message, reorder, reconnect race). Drop
            // this delta and ask the server to resend a full state so we
            // re-anchor. The server clears lastSentState → next broadcast
            // is a full `tmux_state`.
            clientRef.current?.send({ type: "resync_state" });
            return;
          }
          // `applyPatch` mutates by default; clone via structuredClone to
          // keep the base immutable for the next diff apply.
          const next = structuredClone(base);
          try {
            applyPatch(next, msg.patch.ops, /* validate */ false);
          } catch {
            clientRef.current?.send({ type: "resync_state" });
            return;
          }
          next.capturedAt = msg.capturedAt;
          stateBaseRef.current = next;
          stateVersionRef.current = msg.version;
          setSnapshot(next);
          return;
        }
        case "scrollback": {
          const slot = (msg.slot ?? 0) as SlotId;
          setSeed(slot, msg.paneId, msg.text);
          return;
        }
        case "system_stats":
          if (msg.unsupported) {
            markSysinfoUnsupported();
          } else if (msg.sample) {
            ingestSysinfo(msg.sample);
          }
          return;
        case "error":
          // These are routine command/validation failures from the backend
          // (e.g. `tmux new-session` hit a duplicate name). Surface as a
          // toast and stay connected. Previously this called the auth
          // store's setError, which flipped auth.phase to "failed" — that
          // in turn tore down the control WS and forced the user back
          // through the password prompt for what should have been a
          // non-fatal error.
          pushToast({ kind: "error", message: msg.message });
          return;
        default:
          // info handled in later phases
          return;
      }
    };

    // A dropped WebSocket is NOT an auth failure — keep the user on their
    // terminal view and surface a Reconnect button via the TopBar. Flipping
    // auth.phase to "failed" here bounced users into the error screen every
    // time the backend restarted, losing scroll position and seed state.
    const onStatus = (status: ControlWsStatus): void => {
      setConnectionStatus(status);
    };

    const client = new ControlWsClient({
      token,
      password: password || undefined,
      onMessage,
      onStatus,
      capabilities: { stateDelta: true }
    });
    clientRef.current = client;
    stateBaseRef.current = null;
    stateVersionRef.current = 0;
    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
      stateBaseRef.current = null;
      stateVersionRef.current = 0;
    };
  }, [
    shouldConnect,
    token,
    password,
    reconnectTick,
    setAttached,
    setClientId,
    setConnectionStatus,
    setError,
    setPhase,
    setSeed,
    setSnapshot,
    ingestSysinfo,
    markSysinfoUnsupported,
    pushToast
  ]);

  const send = (message: ControlClientMessage): void => {
    clientRef.current?.send(message);
  };

  return { send };
}

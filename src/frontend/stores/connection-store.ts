import { create } from "zustand";

/**
 * Transport state, separate from auth state. A dropped WebSocket is an
 * operational problem (LTE blip, backend restart) — not an auth failure. Auth
 * ran once at connect time; re-opening the same token/password is enough.
 */
export type ConnectionStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "closed"; code: number; reason: string };

export interface ConnectionState {
  status: ConnectionStatus;
  /**
   * Monotonic counter incremented by `reconnect()`. `use-control-session`
   * reads this in its effect deps so each bump tears down the stale
   * WebSocket and opens a fresh one through the normal connect path —
   * avoids the hand-rolled "close-and-reopen" that otherwise has to
   * reconstruct the message-handler closure.
   */
  reconnectTick: number;
  /**
   * Bumps on every `auth_ok` (initial or reconnect). Components that hold
   * per-session derived state on the frontend — e.g. SlotFrame's
   * lastDispatched/lastDims dedup refs — key off this so the new backend
   * session (which has no slot/runtime state) gets a fresh terminal_ready +
   * select_session handshake instead of being silently deduped against the
   * previous session. Without this, a reconnect would leave the client
   * waiting on a never-arriving spontaneous resize.
   */
  authEpoch: number;
  setStatus(status: ConnectionStatus): void;
  reconnect(): void;
  bumpAuthEpoch(): void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: { kind: "idle" },
  reconnectTick: 0,
  authEpoch: 0,
  setStatus: (status) => set({ status }),
  reconnect: () => set((state) => ({ reconnectTick: state.reconnectTick + 1 })),
  bumpAuthEpoch: () => set((state) => ({ authEpoch: state.authEpoch + 1 }))
}));

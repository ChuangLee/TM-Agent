import { create } from "zustand";
import type { TmuxSessionState, TmuxStateSnapshot } from "../../shared/protocol.js";

export interface SessionsState {
  snapshot: TmuxStateSnapshot | null;
  /** Managed grouped client-session name (tm-agent-client-<id>). */
  attachedSession: string;
  /** Real base session the user picked (e.g. "mtmux", "work"). */
  attachedBaseSession: string;
  setSnapshot(snapshot: TmuxStateSnapshot): void;
  setAttached(managed: string, base: string): void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  snapshot: null,
  attachedSession: "",
  attachedBaseSession: "",
  setSnapshot: (snapshot) => set({ snapshot }),
  setAttached: (managed, base) => set({ attachedSession: managed, attachedBaseSession: base })
}));

export const selectAttachedBaseState = (
  snapshot: TmuxStateSnapshot | null,
  attachedBaseSession: string
): TmuxSessionState | undefined => {
  if (!snapshot || !attachedBaseSession) return undefined;
  return snapshot.sessions.find((s) => s.name === attachedBaseSession);
};

export const selectBaseSessions = (snapshot: TmuxStateSnapshot | null): TmuxSessionState[] =>
  (snapshot?.sessions ?? []).filter((s) => !s.name.startsWith("tm-agent-client-"));

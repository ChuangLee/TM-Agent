import { create } from "zustand";

/**
 * Server-side runtime config exposed via `/api/config`. Kept in its own
 * tiny store because App.tsx fetches it once at mount and a few unrelated
 * features (NewSessionSheet's default cwd, DirectoryPicker's root clamp)
 * need read-only access without prop-drilling. See ADR-0017.
 */
export interface ServerConfigState {
  workspaceRoot: string | null;
  setWorkspaceRoot: (root: string) => void;
}

export const useServerConfigStore = create<ServerConfigState>((set) => ({
  workspaceRoot: null,
  setWorkspaceRoot: (root) => set({ workspaceRoot: root })
}));

import { create } from "zustand";
import { fetchShellHistory, type ShellHistoryEntry } from "../services/shell-history-api.js";

export interface ShellHistoryState {
  entries: ShellHistoryEntry[];
  loaded: boolean;
  loading: boolean;
  /** Kick off the fetch. Idempotent — multiple callers during auth are fine. */
  ensureLoaded(): Promise<void>;
  /** Re-fetch; used after an explicit user gesture like "refresh completions". */
  refresh(): Promise<void>;
}

export const useShellHistoryStore = create<ShellHistoryState>((set, get) => ({
  entries: [],
  loaded: false,
  loading: false,
  ensureLoaded: async () => {
    const s = get();
    if (s.loaded || s.loading) return;
    await get().refresh();
  },
  refresh: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const entries = await fetchShellHistory();
      set({ entries, loaded: true, loading: false });
    } catch {
      // Non-fatal — completions fall back to the static catalog.
      set({ loading: false });
    }
  }
}));

import { create } from "zustand";

export interface ComposeDraftStore {
  drafts: Record<string, string>;
  setDraft(sessionId: string, text: string): void;
  getDraft(sessionId: string): string;
  clearDraft(sessionId: string): void;
}

export const useComposeDraftStore = create<ComposeDraftStore>((set, get) => ({
  drafts: {},
  setDraft(sessionId, text) {
    if (!sessionId) return;
    const cur = get().drafts;
    if (!text) {
      // Empty → drop the entry so snapshot reads cleanly.
      if (!(sessionId in cur)) return;
      const { [sessionId]: _removed, ...rest } = cur;
      void _removed;
      set({ drafts: rest });
      return;
    }
    if (cur[sessionId] === text) return;
    set({ drafts: { ...cur, [sessionId]: text } });
  },
  getDraft(sessionId) {
    return get().drafts[sessionId] ?? "";
  },
  clearDraft(sessionId) {
    const cur = get().drafts;
    if (!(sessionId in cur)) return;
    const { [sessionId]: _removed, ...rest } = cur;
    void _removed;
    set({ drafts: rest });
  }
}));

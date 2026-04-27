import { create } from "zustand";

export type FocusCallback = (prefill?: string) => void;

export interface ComposeBridgeStore {
  focusCallback: FocusCallback | null;
  register(cb: FocusCallback): () => void;
  focus(prefill?: string): void;
}

export const useComposeBridge = create<ComposeBridgeStore>((set, get) => ({
  focusCallback: null,
  register(cb) {
    set({ focusCallback: cb });
    return () => {
      if (get().focusCallback === cb) set({ focusCallback: null });
    };
  },
  focus(prefill) {
    get().focusCallback?.(prefill);
  }
}));

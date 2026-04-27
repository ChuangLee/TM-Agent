import { create } from "zustand";
import type { SlotId } from "./layout-store.js";

export type SheetState =
  | { kind: "none" }
  | { kind: "session-actions"; session: string }
  | { kind: "rename-session"; session: string }
  | {
      kind: "new-session";
      /**
       * ADR-0013: when a multi-slot empty picker triggers New session, the
       * created session attaches to that slot. Omitted = legacy single-pane
       * behaviour (defaults to slot 0).
       */
      slot?: SlotId;
    }
  | {
      kind: "window-actions";
      session: string;
      windowIndex: number;
      windowName: string;
    }
  | {
      kind: "rename-window";
      session: string;
      windowIndex: number;
      currentName: string;
    };

export interface SheetStoreState {
  active: SheetState;
  open(state: Exclude<SheetState, { kind: "none" }>): void;
  close(): void;
}

export const useSheetStore = create<SheetStoreState>((set) => ({
  active: { kind: "none" },
  open: (state) => set({ active: state }),
  close: () => set({ active: { kind: "none" } })
}));

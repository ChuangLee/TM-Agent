import { create } from "zustand";
import {
  initialShellStateResult,
  type ShellStateResult
} from "../features/shell-state/state-definitions.js";

export interface ShellStateStore {
  current: ShellStateResult;
  previous: ShellStateResult | null;
  set(result: ShellStateResult): void;
}

export const useShellStateStore = create<ShellStateStore>((set, get) => ({
  current: initialShellStateResult(),
  previous: null,
  set(result) {
    const cur = get().current;
    if (
      cur.state === result.state &&
      cur.confidence === result.confidence &&
      cur.paneCurrentCommand === result.paneCurrentCommand &&
      cur.altScreen === result.altScreen
    ) {
      return;
    }
    set({ previous: cur, current: result });
  }
}));

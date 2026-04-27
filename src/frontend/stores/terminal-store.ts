import { create } from "zustand";
import type { SlotId } from "./layout-store.js";

/**
 * Pending history seed sent by the backend on attach. Consumed once by the
 * terminal hook; subsequent attaches (session switch) replace it.
 */
export interface HistorySeed {
  paneId: string;
  text: string;
  receivedAt: number;
}

export interface SlotTerminalState {
  seed: HistorySeed | null;
  /**
   * Set the moment the user dispatches `select_session` for THIS slot, cleared
   * once the corresponding new seed has been applied (or a safety timeout
   * fires). The terminal hook for that slot watches this to gate its WS
   * `onData` BEFORE the new tmux attach's initial redraw arrives — earlier
   * gating relied on the seed message to flip the switch, which let pre-seed
   * PTY bytes leak into xterm's write queue and land in the post-reset
   * buffer.
   */
  sessionSwitchPending: boolean;
}

export interface TerminalState {
  slots: Record<SlotId, SlotTerminalState>;
  setSeed(slot: SlotId, paneId: string, text: string): void;
  clearSeed(slot: SlotId): void;
  beginSessionSwitch(slot: SlotId): void;
  endSessionSwitch(slot: SlotId): void;
}

const initialSlot = (): SlotTerminalState => ({
  seed: null,
  sessionSwitchPending: false
});

const initialSlots = (): Record<SlotId, SlotTerminalState> => ({
  0: initialSlot(),
  1: initialSlot(),
  2: initialSlot(),
  3: initialSlot()
});

const patchSlot = (
  slots: Record<SlotId, SlotTerminalState>,
  slot: SlotId,
  patch: Partial<SlotTerminalState>
): Record<SlotId, SlotTerminalState> => ({
  ...slots,
  [slot]: { ...slots[slot], ...patch }
});

export const useTerminalStore = create<TerminalState>((set) => ({
  slots: initialSlots(),
  setSeed: (slot, paneId, text) =>
    set((state) => ({
      slots: patchSlot(state.slots, slot, {
        seed: { paneId, text, receivedAt: Date.now() }
      })
    })),
  clearSeed: (slot) =>
    set((state) => ({
      slots: patchSlot(state.slots, slot, { seed: null })
    })),
  beginSessionSwitch: (slot) =>
    set((state) => ({
      slots: patchSlot(state.slots, slot, { sessionSwitchPending: true })
    })),
  endSessionSwitch: (slot) =>
    set((state) => ({
      slots: patchSlot(state.slots, slot, { sessionSwitchPending: false })
    }))
}));

export const selectSlotSeed = (slot: SlotId) => (state: TerminalState) => state.slots[slot].seed;

export const selectSlotSwitchPending = (slot: SlotId) => (state: TerminalState) =>
  state.slots[slot].sessionSwitchPending;

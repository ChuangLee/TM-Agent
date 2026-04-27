import { create } from "zustand";

const MODE_KEY = "tm-agent:layoutMode";

export type LayoutMode = 1 | 2 | 4;

/**
 * Slot id == position (row-major). Quad layout:
 *   0 = top-left, 1 = top-right, 2 = bottom-left, 3 = bottom-right.
 * 2-cols layout uses slots 0 and 1. Single uses slot 0 only. Position is
 * stable so accent colors and Ctrl+1..4 shortcuts can bind to it.
 */
export type SlotId = 0 | 1 | 2 | 3;

export interface SlotState {
  id: SlotId;
  attachedSession: string | null;
}

export interface CloseSlotResult {
  /**
   * Backend slot ids whose grouped session must be torn down. Always includes
   * the closed slot. May also include the previous positions of survivors
   * whose layout slot id changed under ADR-0013 §5 packing rules.
   */
  vacatedSlots: SlotId[];
  newMode: LayoutMode;
}

export interface LayoutState {
  mode: LayoutMode;
  slots: SlotState[];
  focusedSlot: SlotId;
  setMode(mode: LayoutMode): void;
  setFocus(slot: SlotId): void;
  attachToSlot(slot: SlotId, session: string): void;
  detachSlot(slot: SlotId): void;
  /**
   * Close + auto-collapse + repack survivors into bottom slots. Returns the
   * list of backend slot ids that need a `detach_slot` protocol message.
   * Caller is responsible for dispatching those; this store is protocol-free.
   * Survivor SlotFrames will pick up their new attachedSession via the
   * existing effect and emit `select_session` themselves once their new
   * Surface fires `terminal_ready`.
   */
  closeSlot(slot: SlotId): CloseSlotResult;
}

const ALL_SLOTS: SlotId[] = [0, 1, 2, 3];

const slotsForMode = (mode: LayoutMode, prev?: SlotState[]): SlotState[] => {
  return ALL_SLOTS.slice(0, mode).map((id) => ({
    id: id as SlotId,
    attachedSession: prev?.[id]?.attachedSession ?? null
  }));
};

const readInitialMode = (): LayoutMode => {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (raw === "2") return 2;
    if (raw === "4") return 4;
  } catch {
    // localStorage unavailable — fall through.
  }
  return 1;
};

const persistMode = (mode: LayoutMode): void => {
  try {
    localStorage.setItem(MODE_KEY, String(mode));
  } catch {
    // Ignore — behavior still works.
  }
};

const clampFocus = (focused: SlotId, mode: LayoutMode): SlotId => {
  return (focused < mode ? focused : 0) as SlotId;
};

const initialMode = readInitialMode();

export const useLayoutStore = create<LayoutState>((set) => ({
  mode: initialMode,
  slots: slotsForMode(initialMode),
  focusedSlot: 0,
  setMode: (mode) => {
    persistMode(mode);
    set((state) => ({
      mode,
      slots: slotsForMode(mode, state.slots),
      focusedSlot: clampFocus(state.focusedSlot, mode)
    }));
  },
  setFocus: (slot) => {
    set((state) => {
      if (slot >= state.mode) return state;
      return { focusedSlot: slot };
    });
  },
  attachToSlot: (slot, session) => {
    set((state) => {
      if (slot >= state.mode) return state;
      return {
        slots: state.slots.map((s) => (s.id === slot ? { ...s, attachedSession: session } : s))
      };
    });
  },
  detachSlot: (slot) => {
    set((state) => {
      if (slot >= state.mode) return state;
      return {
        slots: state.slots.map((s) => (s.id === slot ? { ...s, attachedSession: null } : s))
      };
    });
  },
  closeSlot: (closedId): CloseSlotResult => {
    const state = useLayoutStore.getState();
    // Survivors = currently attached slots minus the one being closed.
    // Packed in row-major id order (ADR-0013 §5).
    const survivors = state.slots
      .filter((s) => s.id !== closedId && s.attachedSession !== null)
      .sort((a, b) => a.id - b.id);
    const count = survivors.length;
    const newMode: LayoutMode = count <= 1 ? 1 : count === 2 ? 2 : 4;
    const newSlots: SlotState[] = ALL_SLOTS.slice(0, newMode).map((id, i) => ({
      id: id as SlotId,
      attachedSession: survivors[i]?.attachedSession ?? null
    }));

    // Vacated slots that need backend cleanup. Always the closed one.
    const vacated = new Set<SlotId>([closedId]);
    // Survivors that shifted positions: their old position holds a now-stale
    // grouped client; the new position will get a fresh select_session.
    for (let i = 0; i < survivors.length; i++) {
      const oldId = survivors[i].id;
      const newId = i as SlotId;
      if (oldId !== newId) {
        vacated.add(oldId);
      }
    }

    persistMode(newMode);
    set({
      mode: newMode,
      slots: newSlots,
      focusedSlot: clampFocus(state.focusedSlot, newMode)
    });

    return {
      vacatedSlots: Array.from(vacated),
      newMode
    };
  }
}));

export const selectAttachedCount = (state: LayoutState): number => {
  return state.slots.reduce((n, s) => (s.attachedSession ? n + 1 : n), 0);
};

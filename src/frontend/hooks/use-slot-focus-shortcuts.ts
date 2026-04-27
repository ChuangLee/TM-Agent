import { useEffect } from "react";
import { useLayoutStore, type SlotId } from "../stores/layout-store.js";

/**
 * Ctrl+1..4 focus the slot at position 0..3 (ADR-0013 §3).
 * - No-op in single mode (no other slot to focus).
 * - Out-of-range keys for the current mode are ignored (Ctrl+3 in 1×2 mode).
 * - Skipped when focus is in a text input/textarea so it doesn't steal
 *   normal "select word boundary" or text-edit shortcuts.
 * - Direct Mode captures keys at document.capture and routes them to the
 *   PTY before this listener runs — by design (see ADR-0013 §9).
 */
export function useSlotFocusShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey || e.shiftKey) return;
      if (!["1", "2", "3", "4"].includes(e.key)) return;

      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      const layout = useLayoutStore.getState();
      if (layout.mode <= 1) return;
      const slot = (Number(e.key) - 1) as SlotId;
      if (slot >= layout.mode) return;

      e.preventDefault();
      layout.setFocus(slot);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useLayoutStore } from "../../stores/layout-store.js";

/**
 * Tiny strip above the ComposeBar that shows which slot the next compose
 * message will target. Only rendered when the layout has more than one slot
 * — in single-mode the focus is unambiguous. The accent color tracks the
 * focused slot's position-bound palette (ADR-0013 §3).
 */
export function ComposeFocusIndicator(): ReactElement | null {
  const { t } = useTranslation();
  const mode = useLayoutStore((s) => s.mode);
  const focusedSlot = useLayoutStore((s) => s.focusedSlot);
  const session = useLayoutStore(
    (s) => s.slots.find((slot) => slot.id === focusedSlot)?.attachedSession ?? null
  );

  // 200ms flash on focus change so the user notices the target moved.
  const [flash, setFlash] = useState(false);
  const lastFocusRef = useRef(focusedSlot);
  useEffect(() => {
    if (lastFocusRef.current === focusedSlot) return;
    lastFocusRef.current = focusedSlot;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 200);
    return () => clearTimeout(t);
  }, [focusedSlot]);

  if (mode === 1) return null;

  const label = session ?? t("compose.emptySlot");

  return (
    <div
      className="absolute inset-x-0 -top-6 flex items-center gap-2 px-3"
      data-slot={focusedSlot}
      data-testid="compose-focus-indicator"
      style={{ pointerEvents: "none" }}
    >
      <span className="compose-focus-stripe" style={{ height: 12 }} />
      <span className="compose-focus-label" data-flash={flash} data-testid="compose-focus-label">
        → {label}
      </span>
    </div>
  );
}

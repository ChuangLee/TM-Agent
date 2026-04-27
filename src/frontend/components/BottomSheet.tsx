import { useEffect, type ReactElement, type ReactNode } from "react";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Used for testid + aria-label. */
  id: string;
}

/**
 * Reusable bottom-sheet overlay. The SessionDrawer predates this component
 * and has its own inline implementation to keep the keyboard-inset plumbing
 * simple; everything else in the app (rename, per-session actions, per-window
 * actions) should go through BottomSheet for a consistent look + close
 * semantics.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  id
}: BottomSheetProps): ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={id}
      className="fixed inset-0 z-40 flex flex-col justify-end"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        data-unstyled
        className="tm-sheet-backdrop flex-1 cursor-default bg-black/60"
      />
      <div className="tm-sheet-panel rounded-t-xl border-t border-line bg-bg-elev pb-[env(safe-area-inset-bottom)] shadow-2xl md:mx-auto md:w-full md:max-w-md md:rounded-xl md:border md:mb-10">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold text-ink">{title}</span>
          <button type="button" onClick={onClose} className="text-xs text-ink-dim hover:text-ink">
            Close
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

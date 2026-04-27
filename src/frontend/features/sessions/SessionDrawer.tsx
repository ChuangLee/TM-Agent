import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { SessionList } from "./SessionList.js";

export interface SessionDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (session: string) => void;
}

/**
 * Mobile bottom-sheet wrapping `SessionList`. Desktop never renders this —
 * the sidebar already shows the same list permanently. The drawer is a
 * fixed-position overlay rather than a portal because the AppShell already
 * reserves a stacking context and adding a portal would fight the
 * `VisualViewport` keyboard inset plumbing in `use-visual-viewport-inset`.
 */
export function SessionDrawer({
  open,
  onClose,
  onSelect
}: SessionDrawerProps): ReactElement | null {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={t("sessions.drawerLabel")}
      data-testid="session-drawer"
    >
      <button
        type="button"
        aria-label={t("sessions.drawerClose")}
        onClick={onClose}
        data-unstyled
        className="tm-sheet-backdrop flex-1 cursor-default bg-black/60"
      />
      <div className="tm-sheet-panel rounded-t-xl border-t border-line bg-bg-elev pb-[env(safe-area-inset-bottom)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold text-ink">{t("sessions.drawerLabel")}</span>
          <button type="button" onClick={onClose} className="text-xs text-ink-dim">
            {t("sessions.drawerCloseShort")}
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto pb-3">
          <SessionList
            onSelect={(session) => {
              onSelect(session);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}

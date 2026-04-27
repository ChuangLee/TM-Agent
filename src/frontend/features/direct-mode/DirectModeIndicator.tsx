import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface DirectModeIndicatorProps {
  status: "idle" | "entering" | "active" | "exiting";
  onExit(): void;
}

export function DirectModeIndicator({
  status,
  onExit
}: DirectModeIndicatorProps): ReactElement | null {
  const { t } = useTranslation();
  if (status === "idle") return null;
  return (
    <>
      <div className="tm-direct-mode-topglow" data-status={status} aria-hidden="true" />
      <aside
        className="tm-direct-mode-indicator"
        role="status"
        aria-live="polite"
        data-status={status}
      >
        <div className="tm-direct-mode-head">
          <span className="tm-direct-mode-pulse" aria-hidden="true" />
          <span className="tm-direct-mode-title">{t("directMode.title")}</span>
          <button
            type="button"
            className="tm-direct-mode-exit-btn"
            onClick={onExit}
            aria-label={t("directMode.exitLabel")}
            title={t("directMode.exitLabel")}
          >
            ✕
          </button>
        </div>
        <div className="tm-direct-mode-caption">{t("directMode.caption")}</div>
        <div className="tm-direct-mode-hint">
          <kbd className="tm-direct-mode-kbd">Ctrl</kbd>
          <span aria-hidden="true">+</span>
          <kbd className="tm-direct-mode-kbd">]</kbd>
          <span className="tm-direct-mode-hint-or">{t("directMode.hintOr")}</span>
          <kbd className="tm-direct-mode-kbd">Shift</kbd>
          <span aria-hidden="true">+</span>
          <kbd className="tm-direct-mode-kbd">Esc</kbd>
          <span className="tm-direct-mode-hint-trail">{t("directMode.hintTrail")}</span>
        </div>
      </aside>
    </>
  );
}

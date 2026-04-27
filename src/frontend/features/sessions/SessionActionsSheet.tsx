import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../../components/BottomSheet.js";

export interface SessionActionsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Session name the actions apply to. */
  session: string;
  onRename: () => void;
  onKill: () => void;
}

/**
 * Bottom-sheet offering Rename / Kill for a single session. Kill uses the
 * "tap-once to arm, tap-twice to confirm" idiom so an accidental tap on the
 * destructive action doesn't nuke the session. See DESIGN_PRINCIPLES §4:
 * sessions are top-level navigation — losing one by accident is expensive.
 */
export function SessionActionsSheet({
  open,
  onClose,
  session,
  onRename,
  onKill
}: SessionActionsSheetProps): ReactElement {
  const { t } = useTranslation();
  const [killArmed, setKillArmed] = useState(false);

  const handleClose = (): void => {
    setKillArmed(false);
    onClose();
  };

  const handleKill = (): void => {
    if (!killArmed) {
      setKillArmed(true);
      return;
    }
    onKill();
    setKillArmed(false);
  };

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title={t("sessions.sessionSheetTitle", { name: session })}
      id="session-actions-sheet"
    >
      <ul className="flex flex-col gap-0.5 py-2">
        <li>
          <button
            type="button"
            onClick={onRename}
            data-testid="session-action-rename"
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-ink hover:bg-bg-raised"
          >
            <span aria-hidden="true">✎</span>
            <span>{t("sessions.rename")}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={handleKill}
            data-testid="session-action-kill"
            data-armed={killArmed || undefined}
            className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-bg-raised ${
              killArmed ? "bg-err/10 text-err" : "text-err/80"
            }`}
          >
            <span aria-hidden="true">🗑</span>
            <span>
              {killArmed
                ? t("sessions.killSessionArmed", { name: session })
                : t("sessions.killSession")}
            </span>
          </button>
        </li>
      </ul>
    </BottomSheet>
  );
}

import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../../components/BottomSheet.js";

export interface WindowActionsSheetProps {
  open: boolean;
  onClose: () => void;
  session: string;
  windowIndex: number;
  windowName: string;
  onRename: () => void;
  onKill: () => void;
}

export function WindowActionsSheet({
  open,
  onClose,
  session: _session,
  windowIndex,
  windowName,
  onRename,
  onKill
}: WindowActionsSheetProps): ReactElement {
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
      title={t("sessions.windowSheetTitle", {
        index: windowIndex,
        name: windowName
      })}
      id="window-actions-sheet"
    >
      <ul className="flex flex-col gap-0.5 py-2">
        <li>
          <button
            type="button"
            onClick={onRename}
            data-testid="window-action-rename"
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-ink hover:bg-bg-raised"
          >
            <span aria-hidden="true">✎</span>
            <span>{t("sessions.renameWindow")}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={handleKill}
            data-testid="window-action-kill"
            data-armed={killArmed || undefined}
            className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-bg-raised ${
              killArmed ? "bg-err/10 text-err" : "text-err/80"
            }`}
          >
            <span aria-hidden="true">🗑</span>
            <span>
              {killArmed
                ? t("sessions.killWindowArmed", { name: windowName })
                : t("sessions.killWindow")}
            </span>
          </button>
        </li>
      </ul>
    </BottomSheet>
  );
}

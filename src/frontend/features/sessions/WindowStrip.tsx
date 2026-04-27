import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { selectAttachedBaseState, useSessionsStore } from "../../stores/sessions-store.js";
import { useSheetStore } from "../../stores/sheet-store.js";

export interface WindowStripProps {
  onSelect: (windowIndex: number) => void;
  onNewWindow: () => void;
}

/**
 * Horizontal chip strip of every window in the attached base session. The
 * active window gets an accent highlight; tapping any chip dispatches
 * `select_window`. A trailing `+` chip dispatches `new_window`. Long-press
 * (or ⋯) on a chip opens WindowActionsSheet for rename / kill.
 *
 * Hidden entirely when the session has ≤ 1 window — the chrome would add
 * clutter without functional value.
 */
export function WindowStrip({ onSelect, onNewWindow }: WindowStripProps): ReactElement | null {
  const { t } = useTranslation();
  const snapshot = useSessionsStore((s) => s.snapshot);
  const attached = useSessionsStore((s) => s.attachedBaseSession);
  const base = selectAttachedBaseState(snapshot, attached);
  const openSheet = useSheetStore((s) => s.open);

  if (!base || base.windowStates.length < 2) {
    return null;
  }

  return (
    <div
      data-testid="window-strip"
      className="flex items-center gap-1 overflow-x-auto border-b border-line bg-bg/60 px-2 py-1 backdrop-blur-md"
    >
      {base.windowStates.map((window) => {
        const active = window.active;
        return (
          <div
            key={window.index}
            className={`group flex shrink-0 items-center rounded-md border transition-colors ${
              active ? "border-accent/50 bg-accent/15" : "border-line bg-bg-raised hover:bg-bg-elev"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(window.index)}
              data-testid="window-chip"
              data-window={String(window.index)}
              data-active={active || undefined}
              aria-current={active ? "true" : undefined}
              className={`flex items-center gap-1 px-2 py-1 text-xs font-mono ${
                active ? "text-accent" : "text-ink-dim hover:text-ink"
              }`}
            >
              <span className="text-[10px] opacity-60">{window.index}</span>
              <span className="truncate max-w-[10ch]">{window.name}</span>
              {window.paneCount > 1 && (
                <span className="ml-0.5 rounded bg-bg/50 px-1 text-[9px] text-ink-mute">
                  {window.paneCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openSheet({
                  kind: "window-actions",
                  session: base.name,
                  windowIndex: window.index,
                  windowName: window.name
                });
              }}
              aria-label={t("sessions.windowActionsFor", { name: window.name })}
              data-testid="window-chip-menu"
              data-menu-window={String(window.index)}
              className="px-1.5 py-1 text-[10px] text-ink-mute opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
            >
              ⋯
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNewWindow}
        aria-label={t("sessions.newWindow")}
        data-testid="window-new"
        className="shrink-0 rounded-md border border-dashed border-line px-2 py-1 text-xs text-ink-mute hover:border-accent/50 hover:text-accent"
      >
        +
      </button>
    </div>
  );
}

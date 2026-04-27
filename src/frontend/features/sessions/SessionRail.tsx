import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { selectBaseSessions, useSessionsStore } from "../../stores/sessions-store.js";
import { useConnectionStore } from "../../stores/connection-store.js";
import { SysinfoRailDots } from "../sysinfo/SysinfoRailDots.js";

export interface SessionRailProps {
  onSelect: (session: string) => void;
  onExpand: () => void;
}

const initialsOf = (name: string): string => {
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
};

/**
 * Collapsed-mode sidebar: a 56px vertical rail of session avatar buttons.
 * Attached session gets an accent ring. Tap to switch. No textual labels —
 * tooltips carry the name on pointer hover.
 */
export function SessionRail({ onSelect, onExpand }: SessionRailProps): ReactElement {
  const { t } = useTranslation();
  const snapshot = useSessionsStore((s) => s.snapshot);
  const attached = useSessionsStore((s) => s.attachedBaseSession);
  const status = useConnectionStore((s) => s.status);
  const sessions = selectBaseSessions(snapshot);

  // Now that the desktop TopBar collapses entirely while the connection is
  // healthy, the rail has to carry the connection status itself. Stamped on
  // the *attached* avatar so the dot reads as "you, here, online" — matches
  // the old TopBar StatusDot semantics without spending a row.
  const dotClass =
    status.kind === "open"
      ? "bg-emerald-400"
      : status.kind === "connecting"
        ? "bg-amber-400 animate-pulse"
        : status.kind === "closed"
          ? "bg-red-500"
          : "bg-ink-mute";
  const dotTitle =
    status.kind === "open"
      ? t("topBar.statusConnected")
      : status.kind === "connecting"
        ? t("topBar.statusConnecting")
        : status.kind === "closed"
          ? t("topBar.statusDisconnected", { code: status.code })
          : t("topBar.statusIdle");

  return (
    <div
      data-testid="session-rail"
      className="flex h-full w-14 flex-col items-center gap-2 border-r border-line bg-bg-elev py-2"
    >
      <button
        type="button"
        aria-label={t("sessions.railExpand")}
        title={t("sessions.railExpandHint")}
        onClick={onExpand}
        className="flex h-9 w-9 items-center justify-center rounded-md text-ink-dim hover:bg-bg-raised hover:text-ink"
      >
        <ChevronsRight />
      </button>
      <div className="mx-2 h-px self-stretch bg-line" />
      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {sessions.map((session) => {
          const isAttached = session.name === attached;
          return (
            <li key={session.name}>
              <button
                type="button"
                aria-label={session.name}
                title={`${session.name} · ${t(
                  session.windows === 1 ? "topBar.windowsOne" : "topBar.windowsOther",
                  { count: session.windows }
                )}${isAttached ? ` · ${dotTitle}` : ""}`}
                onClick={() => onSelect(session.name)}
                data-testid="session-rail-item"
                data-session={session.name}
                aria-current={isAttached ? "true" : undefined}
                className={`relative flex h-10 w-10 items-center justify-center rounded-lg font-mono text-xs font-semibold transition-colors ${
                  isAttached
                    ? "bg-accent/15 text-accent ring-2 ring-accent"
                    : "bg-bg-raised text-ink-dim hover:bg-bg hover:text-ink"
                }`}
              >
                {initialsOf(session.name)}
                {isAttached && (
                  <span
                    aria-hidden="true"
                    data-testid="session-rail-status"
                    data-status={status.kind}
                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg-elev ${dotClass}`}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <SysinfoRailDots />
    </div>
  );
}

function ChevronsRight(): ReactElement {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M4.21 5.23a.75.75 0 0 1 1.06-.02L9.77 9.47a.75.75 0 0 1 0 1.06l-4.5 4.26a.75.75 0 1 1-1.04-1.08L8.16 10l-3.93-3.71a.75.75 0 0 1-.02-1.06Zm6 0a.75.75 0 0 1 1.06-.02L15.77 9.47a.75.75 0 0 1 0 1.06l-4.5 4.26a.75.75 0 1 1-1.04-1.08L14.16 10l-3.93-3.71a.75.75 0 0 1-.02-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

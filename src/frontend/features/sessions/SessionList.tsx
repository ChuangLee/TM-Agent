import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useSessionsStore } from "../../stores/sessions-store.js";
import { useSheetStore } from "../../stores/sheet-store.js";
import { formatRelativeTime } from "../../lib/format-relative-time.js";

export interface SessionListProps {
  onSelect: (session: string) => void;
}

/** Safety ceiling: backend fail modes should still clear the pending mark so
 * the tiny spinner doesn't sit forever. Real attaches land in ~1s; 4s is a
 * generous "the handshake is clearly wedged, stop pretending" fallback. */
const PENDING_CLEAR_MS = 4000;

/**
 * Presentational list of tmux sessions from the latest snapshot. Every
 * non-managed base session becomes a row; the `attached` flag marks the
 * one this client is currently bound to. Tap the row to switch, tap ⋯ to
 * open SessionActionsSheet (rename / kill). Used in two places:
 *
 *   - Desktop: permanent sidebar (src/frontend/app/App.tsx).
 *   - Mobile: inside a bottom-sheet SessionDrawer.
 */
export function SessionList({ onSelect }: SessionListProps): ReactElement {
  const { t } = useTranslation();
  const snapshot = useSessionsStore((s) => s.snapshot);
  const attachedBaseSession = useSessionsStore((s) => s.attachedBaseSession);
  const openSheet = useSheetStore((s) => s.open);

  // `pendingSession` is the row the user JUST tapped but for which the
  // backend hasn't echoed `attached` yet. It drives the per-row spinner +
  // immediate highlight so the user gets visual confirmation their tap was
  // registered, even while the 1–2s WS round-trip is still in flight.
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingSession && pendingSession === attachedBaseSession) {
      setPendingSession(null);
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    }
  }, [pendingSession, attachedBaseSession]);
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
      }
    };
  }, []);

  const handleSelect = (name: string): void => {
    if (name !== attachedBaseSession) {
      setPendingSession(name);
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
      }
      pendingTimerRef.current = window.setTimeout(() => {
        setPendingSession(null);
        pendingTimerRef.current = null;
      }, PENDING_CLEAR_MS);
    }
    onSelect(name);
  };

  // First-load skeleton: until we have a snapshot, show three pulsing rows
  // instead of "No sessions yet." — the latter is a legitimate empty state
  // that only applies after the backend has answered.
  if (snapshot === null) {
    return (
      <ul
        className="flex flex-col gap-1 px-2 pt-2"
        data-testid="session-list-skeleton"
        aria-busy="true"
      >
        {[0, 1, 2].map((i) => (
          <li key={i} className="px-1">
            <div className="tm-skeleton h-9" />
          </li>
        ))}
      </ul>
    );
  }

  const sessions = snapshot.sessions.filter(
    (session) => !session.name.startsWith("tm-agent-client-")
  );

  const NewSessionRow = (
    <button
      type="button"
      onClick={() => openSheet({ kind: "new-session" })}
      data-testid="session-list-new"
      className="flex w-full items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2 text-left text-xs text-ink-dim transition-colors hover:border-accent hover:bg-bg-raised hover:text-ink"
    >
      <span aria-hidden="true" className="text-sm leading-none">
        ＋
      </span>
      <span className="font-mono">{t("sessions.newSession")}</span>
    </button>
  );

  if (sessions.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-3 px-6 pt-6 text-center"
        data-testid="session-list-empty"
      >
        <span className="text-2xl" aria-hidden="true">
          📭
        </span>
        <p className="text-xs text-ink-mute">{t("sessions.emptyHint")}</p>
        <div className="w-full px-2">{NewSessionRow}</div>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1 px-2 pt-2" data-testid="session-list">
      <li>{NewSessionRow}</li>
      {sessions.map((session) => {
        const isAttached = session.name === attachedBaseSession;
        const isPending = !isAttached && session.name === pendingSession;
        const lastSeen = formatRelativeTime(session.lastActivity);
        return (
          <li key={session.name}>
            <div
              className={`group flex items-center gap-1 rounded-md transition-colors ${
                isAttached
                  ? "bg-bg-raised ring-1 ring-accent/40"
                  : isPending
                    ? "bg-bg-raised/70 ring-1 ring-accent/20"
                    : "hover:bg-bg-raised"
              }`}
              data-pending={isPending ? "true" : "false"}
            >
              <button
                type="button"
                onClick={() => handleSelect(session.name)}
                aria-current={isAttached ? "true" : undefined}
                aria-busy={isPending ? "true" : undefined}
                data-testid="session-list-item"
                data-session={session.name}
                className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-[transform,color] active:scale-[0.985] ${
                  isAttached || isPending ? "text-ink" : "text-ink-dim hover:text-ink"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {isPending && (
                    <span
                      className="tm-session-pending-dot"
                      aria-hidden="true"
                      data-testid="session-list-pending-dot"
                    />
                  )}
                  <span className="truncate font-mono">{session.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[10px] text-ink-mute">
                  {lastSeen && <span>{lastSeen}</span>}
                  <span>{session.windows}w</span>
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openSheet({ kind: "session-actions", session: session.name });
                }}
                aria-label={`Actions for ${session.name}`}
                data-testid="session-list-menu"
                data-menu-session={session.name}
                className="mr-1 h-7 w-7 shrink-0 rounded-md text-ink-mute opacity-60 transition-opacity hover:bg-bg hover:text-ink hover:opacity-100 group-hover:opacity-100"
              >
                ⋯
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

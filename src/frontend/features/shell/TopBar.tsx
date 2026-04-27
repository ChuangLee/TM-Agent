import type { ReactElement, SVGProps } from "react";
import { useTranslation } from "react-i18next";
import { useConnectionStore } from "../../stores/connection-store.js";
import {
  selectAttachedBaseState,
  selectBaseSessions,
  useSessionsStore
} from "../../stores/sessions-store.js";

export interface TopBarProps {
  /**
   * Invoked when the user taps the session affordance on viewports without a
   * visible full-width sidebar. On mobile this opens SessionDrawer; on a
   * collapsed desktop rail the same tap expands the rail. App.tsx wires the
   * right target based on viewport + sidebar state.
   */
  onRequestSessionDrawer?: () => void;
  /**
   * Invoked when the user taps the ⌨ button. Only rendered on mobile — the
   * KeyOverlay is a mobile-keyboard substitute and makes no sense next to a
   * physical keyboard. Expected to toggle: a second tap closes the overlay.
   */
  onToggleKeyOverlay?: () => void;
  /** Whether the KeyOverlay is currently open — drives the ⌨ button state. */
  keyOverlayOpen?: boolean;
  /**
   * Whether the desktop Sidebar is currently expanded. Drives the session
   * pill's md: visibility: expanded → hidden on desktop (Sidebar header owns
   * the session identity surface), collapsed → visible on desktop (the rail
   * only shows initials, so TopBar carries the full name). Mobile ignores
   * this flag — the pill is always shown.
   */
  sidebarExpanded?: boolean;
  /** Optional right-slot content (e.g. the Direct Mode toggle). */
  rightExtras?: ReactElement;
}

export function TopBar({
  onRequestSessionDrawer,
  onToggleKeyOverlay,
  keyOverlayOpen,
  sidebarExpanded,
  rightExtras
}: TopBarProps): ReactElement {
  const { t } = useTranslation();
  const snapshot = useSessionsStore((s) => s.snapshot);
  const attachedBase = useSessionsStore((s) => s.attachedBaseSession);
  const attachedManaged = useSessionsStore((s) => s.attachedSession);
  const base = selectAttachedBaseState(snapshot, attachedBase);
  const baseSessions = selectBaseSessions(snapshot);
  const name = base?.name ?? attachedBase ?? (attachedManaged ? t("topBar.attaching") : "main");
  const windowCount = base?.windowStates.length ?? 0;
  const canSwitch = baseSessions.length >= 2;

  const status = useConnectionStore((s) => s.status);
  const reconnect = useConnectionStore((s) => s.reconnect);

  const isClosed = status.kind === "closed";

  // Desktop has no use for the TopBar while the connection is healthy:
  //   - sidebar header (expanded) or rail avatar status dot (collapsed)
  //     already shows session name + connection state
  //   - Direct Mode moved into ComposeBar
  //   - Layout moved into the sidebar Sessions section
  //   - ⌨ is mobile-only
  // So collapse the row on desktop unless we need to surface the Reconnect
  // affordance. Mobile (no md:) keeps showing — the session pill there is
  // the only way to open the SessionDrawer, and there's no rail/status dot.
  const desktopSilent = !isClosed;
  void sidebarExpanded;

  return (
    <header
      className={`relative z-[1100] flex h-12 items-center justify-between border-b border-line bg-bg/85 px-3 backdrop-blur-md ${
        desktopSilent ? "md:hidden" : ""
      }`}
    >
      <button
        type="button"
        aria-label={t("topBar.sessions")}
        aria-haspopup={canSwitch ? "menu" : undefined}
        onClick={onRequestSessionDrawer}
        data-testid="topbar-session"
        data-session={base?.name ?? ""}
        className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left leading-tight cursor-pointer hover:bg-bg-raised ${
          sidebarExpanded ? "md:hidden" : "md:flex"
        }`}
      >
        <StatusDot status={status} />
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1">
            <span className="truncate font-mono text-sm font-semibold text-ink">{name}</span>
            {canSwitch && <ChevronDown className="shrink-0 text-ink-mute" aria-hidden="true" />}
          </span>
          {windowCount > 0 && (
            <span className="text-[10px] text-ink-mute">
              {t(windowCount === 1 ? "topBar.windowsOne" : "topBar.windowsOther", {
                count: windowCount
              })}
            </span>
          )}
        </span>
      </button>
      {/* Desktop + sidebar-expanded: the pill is hidden; sidebar header owns
          the session identity surface. Leave a flex filler so right-side
          controls stay right-aligned. */}
      {sidebarExpanded && <span className="hidden md:block" />}
      <div className="flex items-center gap-2">
        {isClosed && (
          <button
            type="button"
            onClick={reconnect}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-bg"
          >
            {t("topBar.reconnect")}
          </button>
        )}
        {onToggleKeyOverlay && (
          <button
            type="button"
            onClick={onToggleKeyOverlay}
            aria-label={keyOverlayOpen ? t("topBar.keyOverlayClose") : t("topBar.keyOverlayOpen")}
            aria-pressed={keyOverlayOpen}
            data-testid="topbar-key-overlay"
            className={
              "flex h-8 items-center justify-center rounded-md px-2.5 text-sm font-semibold md:hidden " +
              (keyOverlayOpen
                ? "bg-accent text-bg"
                : "border border-line text-ink hover:bg-bg-elev")
            }
          >
            ⌨
          </button>
        )}
        {rightExtras}
      </div>
    </header>
  );
}

interface StatusDotProps {
  status: ReturnType<typeof useConnectionStore.getState>["status"];
}

function StatusDot({ status }: StatusDotProps): ReactElement {
  const { t } = useTranslation();
  const { kind } = status;
  const label =
    kind === "open"
      ? t("topBar.statusConnected")
      : kind === "connecting"
        ? t("topBar.statusConnecting")
        : kind === "closed"
          ? t("topBar.statusDisconnected", { code: status.code })
          : t("topBar.statusIdle");
  const color =
    kind === "open"
      ? "bg-emerald-400"
      : kind === "connecting"
        ? "bg-amber-400 animate-pulse"
        : kind === "closed"
          ? "bg-red-500"
          : "bg-ink-mute";

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      data-testid="connection-status"
      data-status={kind}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`}
    />
  );
}

function ChevronDown({ className, ...rest }: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      width="12"
      height="12"
      className={className}
      {...rest}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.24 4.5a.75.75 0 0 1-1.08 0l-4.24-4.5a.75.75 0 0 1 .02-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

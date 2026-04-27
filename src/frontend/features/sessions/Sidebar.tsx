import { useEffect, useRef, useState, type ReactElement } from "react";
import { useConnectionStore } from "../../stores/connection-store.js";
import { selectAttachedBaseState, useSessionsStore } from "../../stores/sessions-store.js";
import { useUiStore } from "../../stores/ui-store.js";
import { SysinfoPanel } from "../sysinfo/SysinfoPanel.js";
import { LanguageSwitcher } from "../../components/LanguageSwitcher.js";
import { FilePanel } from "../files/FilePanel.js";
import { SessionList } from "./SessionList.js";
import { SessionRail } from "./SessionRail.js";
import { LayoutButton } from "../shell/LayoutButton.js";

export interface SidebarProps {
  onSelect: (session: string) => void;
}

/**
 * Desktop-only sidebar. Owns the "current session identity" surface when
 * expanded: status dot + session name live at the top. When collapsed, the
 * TopBar takes over that role (see Sidebar.tsx ↔ TopBar.tsx contract in
 * ADR-0010). Mobile never mounts this — SessionDrawer handles that case.
 *
 * Layout (expanded, top to bottom):
 *   - SidebarHeader — 48px, status + session name + collapse button
 *   - SESSIONS section — capped height (~220px ≈ 4–5 rows + "+ New
 *     session"), scrollable with top/bottom fade indicators when the
 *     session count overflows
 *   - FILES section — flex-1, hosts the FilePanel (breadcrumbs + tree)
 *   - SysinfoPanel — docked at the bottom
 *
 * This "both at once" layout replaced the earlier Sessions/Files tab
 * switcher so the middle of the sidebar (which was mostly empty with the
 * typical 2–5 sessions the user has) now carries the file browser.
 */
export function Sidebar({ onSelect }: SidebarProps): ReactElement {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);

  if (collapsed) {
    return <SessionRail onSelect={onSelect} onExpand={toggle} />;
  }

  return (
    <div
      data-testid="sidebar"
      className="flex h-full w-full flex-col border-r border-line bg-bg-elev"
    >
      <SidebarHeader onCollapse={toggle} />
      <SessionsSection onSelect={onSelect} />
      <FilesSection />
      <SysinfoPanel />
      <div className="border-t border-line px-1 py-1">
        <LanguageSwitcher variant="inline" />
      </div>
    </div>
  );
}

function SectionLabel({ text, trailing }: { text: string; trailing?: ReactElement }): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-bg-elev px-3 pb-1 pt-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
        {text}
      </span>
      {trailing && <span className="ml-auto flex items-center">{trailing}</span>}
    </div>
  );
}

function SessionsSection({ onSelect }: { onSelect: (session: string) => void }): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    canScrollUp: false,
    canScrollDown: false
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = (): void => {
      // -1px tolerance: fractional scroll positions on some browsers (hi-DPI
      // zoom) leave scrollTop like 207.5 and scrollHeight 209, so strict
      // equality under-detects "at bottom".
      const canScrollUp = el.scrollTop > 0;
      const canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setScrollState((prev) =>
        prev.canScrollUp === canScrollUp && prev.canScrollDown === canScrollDown
          ? prev
          : { canScrollUp, canScrollDown }
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // ResizeObserver tracks height changes from viewport resize + list
    // growth (e.g. a session arriving mid-session). jsdom (vitest) doesn't
    // provide one — fall back to scroll + mount-time detection there.
    const ROCtor =
      typeof globalThis.ResizeObserver === "function" ? globalThis.ResizeObserver : null;
    const ro = ROCtor ? new ROCtor(update) : null;
    if (ro) {
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className="flex shrink-0 flex-col" data-testid="sidebar-sessions">
      <SectionLabel text="Sessions" trailing={<LayoutButton />} />
      <div className="relative">
        <div
          ref={scrollRef}
          // max-h tuned to show ~4 full rows + "+ New session" before
          // overflow kicks in. Scale up when the viewport can spare it —
          // at ≥1200px tall, 6 rows fits comfortably.
          className="max-h-[220px] min-h-0 overflow-y-auto pb-2 xl:max-h-[300px]"
        >
          <SessionList onSelect={onSelect} />
        </div>
        {scrollState.canScrollUp && (
          <div
            aria-hidden="true"
            data-testid="sessions-scroll-fade-top"
            className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-bg-elev to-transparent"
          />
        )}
        {scrollState.canScrollDown && (
          <div
            aria-hidden="true"
            data-testid="sessions-scroll-fade-bottom"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-bg-elev to-transparent"
          />
        )}
      </div>
    </div>
  );
}

function FilesSection(): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line" data-testid="sidebar-files">
      <SectionLabel text="Files" />
      <div className="min-h-0 flex-1">
        <FilePanel />
      </div>
    </div>
  );
}

function SidebarHeader({ onCollapse }: { onCollapse: () => void }): ReactElement {
  const snapshot = useSessionsStore((s) => s.snapshot);
  const attached = useSessionsStore((s) => s.attachedBaseSession);
  const base = selectAttachedBaseState(snapshot, attached);
  const status = useConnectionStore((s) => s.status);
  const name = base?.name ?? attached ?? "—";
  const windowCount = base?.windowStates.length ?? 0;

  const dotColor =
    status.kind === "open"
      ? "bg-emerald-400"
      : status.kind === "connecting"
        ? "bg-amber-400 animate-pulse"
        : status.kind === "closed"
          ? "bg-red-500"
          : "bg-ink-mute";

  return (
    <div className="flex h-12 items-center gap-2 border-b border-line px-3">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span
          className="truncate font-mono text-sm font-semibold text-ink"
          data-testid="sidebar-attached-name"
        >
          {name}
        </span>
        {windowCount > 0 && (
          <span className="text-[10px] text-ink-mute">
            {windowCount} window{windowCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label="Collapse sidebar"
        title="Collapse sidebar (Ctrl/⌘+B)"
        onClick={onCollapse}
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-dim hover:bg-bg-raised hover:text-ink"
      >
        <ChevronsLeft />
      </button>
    </div>
  );
}

function ChevronsLeft(): ReactElement {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M15.79 14.77a.75.75 0 0 1-1.06.02L10.23 10.53a.75.75 0 0 1 0-1.06l4.5-4.26a.75.75 0 1 1 1.04 1.08L11.84 10l3.93 3.71a.75.75 0 0 1 .02 1.06Zm-6 0a.75.75 0 0 1-1.06.02L4.23 10.53a.75.75 0 0 1 0-1.06l4.5-4.26a.75.75 0 1 1 1.04 1.08L5.84 10l3.93 3.71a.75.75 0 0 1 .02 1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

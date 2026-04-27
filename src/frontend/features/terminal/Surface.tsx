import { useRef, type ReactElement } from "react";
import { useTerminal } from "./use-terminal.js";
import { useHorizontalSwipe } from "./use-horizontal-swipe.js";
import { useShellState } from "../shell-state/use-shell-state.js";
import type { SlotId } from "../../stores/layout-store.js";

export interface SurfaceProps {
  onReady?: (cols: number, rows: number) => void;
  /**
   * ADR-0013 slot id. Defaults to 0 so Single-mode callers keep working
   * without change. PR #3 / PR #4 wire non-zero slots through MultiSurface.
   */
  slotId?: SlotId;
}

/**
 * Virtual scroll container (ADR-0004 retained) + single-tree DOM renderer
 * (ADR-0005). xterm.js runs headless; `.tm-rows` is the only surface that
 * paints terminal content. Sticky viewport precedes the spacer so the rows
 * stay visible at every scrollTop.
 */
export function Surface({ onReady, slotId = 0 as SlotId }: SurfaceProps = {}): ReactElement {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);

  const { terminal, isAltScreen } = useTerminal({
    scrollerRef,
    spacerRef,
    rowsRef,
    cursorRef,
    onReady,
    slotId
  });

  useShellState(terminal, slotId);

  // Horizontal gesture slot reserved for pane switching (Phase 5). Phase 2
  // wires the detector so vertical scroll wins cleanly; the commit handler
  // stays a no-op until PaneCarousel lands.
  useHorizontalSwipe(scrollerRef, {
    onSwipe: () => {
      /* reserved for PaneCarousel (Phase 5) */
    },
    shouldTrack: (e) => e.pointerType === "touch"
  });

  return (
    <div ref={scrollerRef} className="tm-scroller" data-testid="tm-scroller">
      {/*
       * Viewport FIRST, spacer AFTER. `position: sticky; top: 0` only engages
       * once the element's natural position would scroll past the boundary;
       * with spacer first, the viewport sits below the fold at scrollTop=0.
       */}
      <div className="tm-viewport">
        <div ref={rowsRef} className="tm-rows term-rows" data-testid="tm-rows" />
        <div ref={cursorRef} className="tm-cursor" aria-hidden="true" />
        {isAltScreen && (
          <div className="tm-alt-banner" role="status">
            alt-screen · scrollback paused
          </div>
        )}
      </div>
      <div ref={spacerRef} className="tm-spacer" />
    </div>
  );
}

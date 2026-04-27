import { useEffect, type RefObject } from "react";

export interface HorizontalSwipeOptions {
  /** Gesture has to travel at least this many CSS pixels on the horizontal
   * axis before we even decide on a direction. */
  axisDecisionPx?: number;
  /** Committed travel before the swipe actually fires. */
  commitPx?: number;
  /** If the user drifts vertically by this many px before decision, release
   * ownership to the native scroll engine. */
  verticalLockoutPx?: number;
  /** Called exactly once per gesture, when a swipe commits. */
  onSwipe: (dir: "left" | "right") => void;
  /** Limit to specific pointer types; default is touch only so desktop drag
   * selection on the DOM mirror stays intact. */
  shouldTrack?: (event: PointerEvent) => boolean;
}

/**
 * Horizontal swipe detector for `.tm-scroller` (ADR-0004 §gesture ownership).
 * Reserves the horizontal axis for pane switching while leaving vertical
 * pan-y to the browser's native kinetic engine. Once vertical scroll wins
 * the gesture — either by drift or because `scroll` fires — the detector
 * stands down so we never fight the scroll machinery.
 */
export function useHorizontalSwipe(
  targetRef: RefObject<HTMLElement | null>,
  options: HorizontalSwipeOptions
): void {
  const axisDecisionPx = options.axisDecisionPx ?? 12;
  const commitPx = options.commitPx ?? 60;
  const verticalLockoutPx = options.verticalLockoutPx ?? 8;
  const { onSwipe, shouldTrack } = options;

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    type Phase = "idle" | "tracking" | "committed-horizontal" | "released";
    let phase: Phase = "idle";
    let activePointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let swipeCommitted = false;

    const reset = (): void => {
      phase = "idle";
      activePointerId = null;
      swipeCommitted = false;
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (shouldTrack && !shouldTrack(e)) return;
      reset();
      phase = "tracking";
      activePointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (activePointerId !== e.pointerId) return;
      if (phase === "released" || phase === "idle") return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (phase === "tracking") {
        // Vertical wins: hand off to native scroll.
        if (Math.abs(dy) > verticalLockoutPx && Math.abs(dy) > Math.abs(dx)) {
          phase = "released";
          return;
        }
        if (Math.abs(dx) > axisDecisionPx && Math.abs(dx) > Math.abs(dy)) {
          phase = "committed-horizontal";
        }
        return;
      }

      if (phase === "committed-horizontal" && !swipeCommitted) {
        if (Math.abs(dx) >= commitPx) {
          swipeCommitted = true;
          onSwipe(dx < 0 ? "left" : "right");
        }
      }
    };

    const onPointerEnd = (e: PointerEvent): void => {
      if (activePointerId !== e.pointerId) return;
      reset();
    };

    const onScroll = (): void => {
      // Vertical scroll wins unconditionally; release our gesture slot.
      if (phase === "tracking" || phase === "committed-horizontal") {
        phase = "released";
      }
    };

    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("pointermove", onPointerMove, { passive: true });
    el.addEventListener("pointerup", onPointerEnd, { passive: true });
    el.addEventListener("pointercancel", onPointerEnd, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
      el.removeEventListener("scroll", onScroll);
    };
  }, [targetRef, axisDecisionPx, commitPx, verticalLockoutPx, onSwipe, shouldTrack]);
}

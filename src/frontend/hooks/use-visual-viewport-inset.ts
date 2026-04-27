import { useEffect } from "react";
import { useUiStore } from "../stores/ui-store.js";

/**
 * Mirrors the VisualViewport height into a CSS custom property on <html>
 * (`--app-height`) AND exposes the keyboard inset to the UI store.
 *
 * The CSS var fixes an iOS/Android-class of bug: when the soft keyboard
 * rises, `innerHeight` (and therefore `100dvh`) does NOT shrink, so grid
 * layouts measured against it keep their original height and the bottom
 * content ends up hidden behind the keyboard until a second reflow
 * "catches up" — causing a visible flicker as children thrash between the
 * old and new sizes. By binding the root height to `visualViewport.height`
 * instead, the grid recomputes its tracks in a single layout pass the
 * instant the keyboard animates in. `interactive-widget=resizes-content`
 * in the viewport meta gives newer browsers the same effect natively; the
 * CSS var is the cross-browser fallback.
 *
 * The `keyboardInset` store value is still published for legacy consumers
 * (e.g., ComposeBar's paddingBottom), but with the grid now naturally
 * shrinking, most of them no longer need it.
 */
export function useVisualViewportInset(): void {
  const setKeyboardInset = useUiStore((s) => s.setKeyboardInset);

  useEffect(() => {
    const vv = globalThis.visualViewport;
    const root = document.documentElement;
    if (!vv) {
      root.style.setProperty("--app-height", `${globalThis.innerHeight}px`);
      return;
    }
    const update = (): void => {
      root.style.setProperty("--app-height", `${vv.height}px`);
      const inset = Math.max(0, globalThis.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [setKeyboardInset]);
}

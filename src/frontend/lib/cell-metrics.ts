import { readTerminalMetrics, type TerminalMetrics } from "./terminal-metrics.js";

export interface CellMetrics extends TerminalMetrics {
  cellWidthPx: number;
}

/**
 * Measure the advance width of a single terminal cell. Without xterm.js owning
 * the DOM (ADR-0005), nothing else measures font glyph width for us — we have
 * to do it ourselves so `cols = scroller.clientWidth / cellWidthPx` produces
 * the right number of columns for `term.resize()`.
 *
 * Uses an offscreen span with the same font stack as the rows. Measures "M"
 * (the conventional em-ish character in monospace fonts) and rounds to one
 * decimal to keep the value stable across layout ticks.
 */
export function measureCellMetrics(root: Element = document.documentElement): CellMetrics {
  const base = readTerminalMetrics(root);
  const probe = document.createElement("span");
  probe.textContent = "MMMMMMMMMM"; // average 10 chars for sub-pixel accuracy
  probe.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "top:-9999px",
    "left:-9999px",
    "white-space:pre",
    `font-family:${base.fontFamily}`,
    `font-size:${base.fontSizePx}px`,
    `line-height:${base.lineHeightPx}px`,
    `letter-spacing:${base.letterSpacingPx}px`,
    "font-variant-ligatures:none"
  ].join(";");
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 10;
  probe.remove();
  return {
    ...base,
    cellWidthPx: Math.max(1, Math.round(width * 10) / 10)
  };
}

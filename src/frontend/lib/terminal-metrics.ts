/**
 * Read terminal font metrics from CSS custom properties (`styles/tokens.css`).
 * xterm.js needs numeric values at construction time, but we keep tokens.css
 * as the single source of truth so every DOM mirror lines up with the canvas.
 */
export interface TerminalMetrics {
  fontFamily: string;
  fontSizePx: number;
  lineHeightRatio: number;
  lineHeightPx: number;
  letterSpacingPx: number;
}

function readVar(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

function parsePx(value: string, fallback: number): number {
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (!match) return fallback;
  return Number(match[1]);
}

export function readTerminalMetrics(root: Element = document.documentElement): TerminalMetrics {
  const style = getComputedStyle(root);
  const fontFamily =
    readVar(style, "--term-font-family") || 'Menlo, Monaco, "Courier New", monospace';
  const fontSizePx = parsePx(readVar(style, "--term-font-size"), 13);
  const lineHeightPx = parsePx(readVar(style, "--term-line-height"), 18);
  const letterSpacingPx = parsePx(readVar(style, "--term-letter-spacing"), 0);
  return {
    fontFamily,
    fontSizePx,
    lineHeightRatio: lineHeightPx / fontSizePx,
    lineHeightPx,
    letterSpacingPx
  };
}

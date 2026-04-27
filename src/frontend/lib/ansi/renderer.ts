import type { BufferLineLike, CellLike } from "./types.js";
import { palette256, unpackRgb } from "./palette.js";

interface RunAttrs {
  fgHex: string | null;
  bgHex: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  invisible: boolean;
  strikethrough: boolean;
}

const DEFAULT_ATTRS: RunAttrs = {
  fgHex: null,
  bgHex: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  blink: false,
  invisible: false,
  strikethrough: false
};

function fgHexOf(cell: CellLike): string | null {
  if (cell.isFgPalette()) return palette256(cell.getFgColor());
  if (cell.isFgRGB()) return unpackRgb(cell.getFgColor());
  return null;
}

function bgHexOf(cell: CellLike): string | null {
  if (cell.isBgPalette()) return palette256(cell.getBgColor());
  if (cell.isBgRGB()) return unpackRgb(cell.getBgColor());
  return null;
}

function decodeCell(cell: CellLike): { attrs: RunAttrs; chars: string; width: number } {
  let fgHex = fgHexOf(cell);
  let bgHex = bgHexOf(cell);
  if (cell.isInverse()) {
    [fgHex, bgHex] = [bgHex ?? "var(--term-bg, transparent)", fgHex ?? "currentColor"];
  }
  return {
    attrs: {
      fgHex,
      bgHex,
      bold: !!cell.isBold(),
      dim: !!cell.isDim(),
      italic: !!cell.isItalic(),
      underline: !!cell.isUnderline(),
      blink: !!cell.isBlink(),
      invisible: !!cell.isInvisible(),
      strikethrough: !!cell.isStrikethrough()
    },
    chars: cell.getChars() || " ",
    width: cell.getWidth()
  };
}

function sameAttrs(a: RunAttrs, b: RunAttrs): boolean {
  return (
    a.fgHex === b.fgHex &&
    a.bgHex === b.bgHex &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.blink === b.blink &&
    a.invisible === b.invisible &&
    a.strikethrough === b.strikethrough
  );
}

function isDefaultAttrs(a: RunAttrs): boolean {
  return sameAttrs(a, DEFAULT_ATTRS);
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;"
};
const ESCAPE_RE = /[&<>]/g;

export function escapeHtml(input: string): string {
  return input.replace(ESCAPE_RE, (ch) => ESCAPES[ch] ?? ch);
}

function classString(attrs: RunAttrs): string {
  const parts: string[] = [];
  if (attrs.bold) parts.push("b");
  if (attrs.dim) parts.push("dim");
  if (attrs.italic) parts.push("i");
  if (attrs.underline) parts.push("u");
  if (attrs.blink) parts.push("bl");
  if (attrs.invisible) parts.push("inv");
  if (attrs.strikethrough) parts.push("s");
  return parts.join(" ");
}

function styleString(attrs: RunAttrs): string {
  const parts: string[] = [];
  if (attrs.fgHex) parts.push(`color:${attrs.fgHex}`);
  if (attrs.bgHex) parts.push(`background:${attrs.bgHex}`);
  return parts.join(";");
}

function spanOpen(attrs: RunAttrs, extraClass = ""): string {
  const cls = [extraClass, classString(attrs)].filter(Boolean).join(" ");
  const style = styleString(attrs);
  const clsAttr = cls ? ` class="${cls}"` : "";
  const styleAttr = style ? ` style="${style}"` : "";
  return `<span${clsAttr}${styleAttr}>`;
}

/**
 * Render one xterm buffer line into HTML. Consecutive cells with identical
 * attributes collapse into a single `<span>`; wide-glyph cells get their own
 * `<span class="w">` so DOM width stays aligned with canvas rendering. The
 * output is `white-space: pre`-safe (no trailing trim) and HTML-escaped.
 */
export function renderBufferLine(line: BufferLineLike, cols: number): string {
  const total = Math.min(cols, line.length);
  let html = "";
  let runAttrs: RunAttrs | null = null;
  let runText = "";

  const flushRun = (): void => {
    if (!runAttrs || runText.length === 0) {
      runAttrs = null;
      runText = "";
      return;
    }
    if (isDefaultAttrs(runAttrs)) {
      html += escapeHtml(runText);
    } else {
      html += `${spanOpen(runAttrs)}${escapeHtml(runText)}</span>`;
    }
    runAttrs = null;
    runText = "";
  };

  for (let x = 0; x < total; x++) {
    const cell = line.getCell(x);
    if (!cell) continue;
    const { attrs, chars, width } = decodeCell(cell);
    if (width === 0) continue;
    if (width === 2) {
      flushRun();
      html += `${spanOpen(attrs, "w")}${escapeHtml(chars || " ")}</span>`;
      continue;
    }
    const char = chars || " ";
    if (!runAttrs) {
      runAttrs = attrs;
      runText = char;
    } else if (sameAttrs(runAttrs, attrs)) {
      runText += char;
    } else {
      flushRun();
      runAttrs = attrs;
      runText = char;
    }
  }
  flushRun();
  return html;
}

export function renderBufferLines(
  lines: readonly BufferLineLike[],
  cols: number,
  separator = "\n"
): string {
  return lines.map((l) => renderBufferLine(l, cols)).join(separator);
}

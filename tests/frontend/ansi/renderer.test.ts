import { describe, expect, test } from "vitest";
import { renderBufferLine } from "../../../src/frontend/lib/ansi/renderer.js";
import type { BufferLineLike, CellLike } from "../../../src/frontend/lib/ansi/types.js";

type ColorMode = "default" | "palette" | "rgb";

interface CellSpec {
  chars?: string;
  width?: number;
  fg?: { mode: ColorMode; value: number };
  bg?: { mode: ColorMode; value: number };
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  blink?: boolean;
  invisible?: boolean;
  strikethrough?: boolean;
}

const flag = (b?: boolean): number => (b ? 1 : 0);

function buildCell(spec: CellSpec): CellLike {
  const fg = spec.fg ?? { mode: "default" as const, value: 0 };
  const bg = spec.bg ?? { mode: "default" as const, value: 0 };
  return {
    getChars: () => spec.chars ?? " ",
    getWidth: () => spec.width ?? 1,
    getFgColor: () => fg.value,
    getBgColor: () => bg.value,
    isFgDefault: () => fg.mode === "default",
    isFgPalette: () => fg.mode === "palette",
    isFgRGB: () => fg.mode === "rgb",
    isBgDefault: () => bg.mode === "default",
    isBgPalette: () => bg.mode === "palette",
    isBgRGB: () => bg.mode === "rgb",
    isBold: () => flag(spec.bold),
    isItalic: () => flag(spec.italic),
    isUnderline: () => flag(spec.underline),
    isDim: () => flag(spec.dim),
    isInverse: () => flag(spec.inverse),
    isInvisible: () => flag(spec.invisible),
    isBlink: () => flag(spec.blink),
    isStrikethrough: () => flag(spec.strikethrough)
  };
}

function buildLine(cells: CellSpec[]): BufferLineLike {
  const built = cells.map(buildCell);
  return {
    length: built.length,
    getCell: (x) => built[x]
  };
}

const textLine = (s: string): BufferLineLike => buildLine([...s].map((c) => ({ chars: c })));

describe("renderBufferLine", () => {
  test("plain ASCII emits no spans", () => {
    const line = textLine("hello");
    expect(renderBufferLine(line, 5)).toBe("hello");
  });

  test("escapes HTML special characters", () => {
    const line = textLine("<a&b>");
    expect(renderBufferLine(line, 5)).toBe("&lt;a&amp;b&gt;");
  });

  test("respects the cols cap", () => {
    const line = textLine("abcdefg");
    expect(renderBufferLine(line, 3)).toBe("abc");
  });

  test("coalesces consecutive cells sharing attributes", () => {
    const red = (c: string): CellSpec => ({
      chars: c,
      fg: { mode: "palette", value: 1 }
    });
    const line = buildLine([red("e"), red("r"), red("r")]);
    const html = renderBufferLine(line, 3);
    expect(html).toBe('<span style="color:#cd0000">err</span>');
  });

  test("starts a new run when attributes change", () => {
    const line = buildLine([
      { chars: "a", fg: { mode: "palette", value: 2 } },
      { chars: "b", fg: { mode: "palette", value: 2 }, bold: true },
      { chars: "c" }
    ]);
    const html = renderBufferLine(line, 3);
    expect(html).toBe(
      '<span style="color:#00cd00">a</span>' +
        '<span class="b" style="color:#00cd00">b</span>' +
        "c"
    );
  });

  test("renders 256-palette colors as hex inline", () => {
    const line = buildLine([{ chars: "x", fg: { mode: "palette", value: 196 } }]);
    expect(renderBufferLine(line, 1)).toBe('<span style="color:#ff0000">x</span>');
  });

  test("renders truecolor packed RGB", () => {
    const line = buildLine([{ chars: "y", fg: { mode: "rgb", value: 0x112233 } }]);
    expect(renderBufferLine(line, 1)).toBe('<span style="color:#112233">y</span>');
  });

  test("inverse swaps foreground and background", () => {
    const line = buildLine([
      {
        chars: "z",
        fg: { mode: "palette", value: 7 },
        bg: { mode: "palette", value: 0 },
        inverse: true
      }
    ]);
    expect(renderBufferLine(line, 1)).toBe(
      '<span style="color:#000000;background:#e5e5e5">z</span>'
    );
  });

  test("wide glyph gets its own span with .w and the right half is skipped", () => {
    const line = buildLine([
      { chars: "字", width: 2 },
      { chars: "", width: 0 },
      { chars: "!", width: 1 }
    ]);
    expect(renderBufferLine(line, 3)).toBe('<span class="w">字</span>!');
  });

  test("empty cells render as spaces to preserve column alignment", () => {
    const line = buildLine([{ chars: " " }, { chars: "" }, { chars: "a" }]);
    expect(renderBufferLine(line, 3)).toBe("  a");
  });

  test("underline and strikethrough combine into classes", () => {
    const line = buildLine([{ chars: "t", underline: true, strikethrough: true, bold: true }]);
    expect(renderBufferLine(line, 1)).toBe('<span class="b u s">t</span>');
  });
});

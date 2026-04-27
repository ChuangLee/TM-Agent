import { describe, expect, test } from "vitest";
import { keydownToBytes } from "../../../src/frontend/features/direct-mode/keydown-to-bytes.js";
function e(
  key: string,
  overrides: Partial<KeyboardEventInit & { isComposing: boolean; code: string }> = {}
): KeyboardEvent {
  const evt = {
    key,
    code: overrides.code ?? "",
    altKey: overrides.altKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    metaKey: overrides.metaKey ?? false,
    isComposing: overrides.isComposing ?? false,
    keyCode: 0
  } as unknown as KeyboardEvent;
  return evt;
}

describe("keydownToBytes", () => {
  test("plain letter returns itself", () => {
    expect(keydownToBytes(e("a"))).toBe("a");
    expect(keydownToBytes(e("Z"))).toBe("Z");
  });
  test("digit returns itself", () => {
    expect(keydownToBytes(e("7"))).toBe("7");
  });
  test("Enter → \\r", () => {
    expect(keydownToBytes(e("Enter"))).toBe("\r");
  });
  test("Tab → \\t", () => {
    expect(keydownToBytes(e("Tab"))).toBe("\t");
  });
  test("Backspace → \\x7f", () => {
    expect(keydownToBytes(e("Backspace"))).toBe("\x7f");
  });
  test("Delete → CSI 3~", () => {
    expect(keydownToBytes(e("Delete"))).toBe("\x1b[3~");
  });
  test("Escape → \\x1b", () => {
    expect(keydownToBytes(e("Escape"))).toBe("\x1b");
  });
  test("Arrow keys → CSI ABCD", () => {
    expect(keydownToBytes(e("ArrowUp"))).toBe("\x1b[A");
    expect(keydownToBytes(e("ArrowDown"))).toBe("\x1b[B");
    expect(keydownToBytes(e("ArrowLeft"))).toBe("\x1b[D");
    expect(keydownToBytes(e("ArrowRight"))).toBe("\x1b[C");
  });
  test("Home / End / PgUp / PgDn", () => {
    expect(keydownToBytes(e("Home"))).toBe("\x1b[H");
    expect(keydownToBytes(e("End"))).toBe("\x1b[F");
    expect(keydownToBytes(e("PageUp"))).toBe("\x1b[5~");
    expect(keydownToBytes(e("PageDown"))).toBe("\x1b[6~");
  });
  test("F1-F4 use SS3", () => {
    expect(keydownToBytes(e("F1"))).toBe("\x1bOP");
    expect(keydownToBytes(e("F2"))).toBe("\x1bOQ");
    expect(keydownToBytes(e("F3"))).toBe("\x1bOR");
    expect(keydownToBytes(e("F4"))).toBe("\x1bOS");
  });
  test("F5-F12 use CSI with extended codes", () => {
    expect(keydownToBytes(e("F5"))).toBe("\x1b[15~");
    expect(keydownToBytes(e("F6"))).toBe("\x1b[17~");
    expect(keydownToBytes(e("F12"))).toBe("\x1b[24~");
  });
  test("Ctrl+c → \\x03", () => {
    expect(keydownToBytes(e("c", { ctrlKey: true }))).toBe("\x03");
  });
  test("Ctrl+D → \\x04", () => {
    expect(keydownToBytes(e("D", { ctrlKey: true }))).toBe("\x04");
  });
  test("Ctrl+Z → \\x1a", () => {
    expect(keydownToBytes(e("Z", { ctrlKey: true }))).toBe("\x1a");
  });
  test("Alt+letter → ESC prefix", () => {
    expect(keydownToBytes(e("f", { altKey: true }))).toBe("\x1bf");
    expect(keydownToBytes(e("b", { altKey: true }))).toBe("\x1bb");
  });
  test("composition events skipped (isComposing true)", () => {
    expect(keydownToBytes(e("a", { isComposing: true }))).toBeNull();
  });
  test("browser-reserved Cmd/Ctrl+W/T/R/N/Q skipped", () => {
    expect(keydownToBytes(e("t", { ctrlKey: true }))).toBeNull();
    expect(keydownToBytes(e("W", { ctrlKey: true }))).toBeNull();
    expect(keydownToBytes(e("n", { metaKey: true }))).toBeNull();
    expect(keydownToBytes(e("q", { metaKey: true }))).toBeNull();
  });
  test("unknown non-string keys return null", () => {
    expect(keydownToBytes(e("Dead"))).toBeNull();
    expect(keydownToBytes(e("Unidentified"))).toBeNull();
  });
});

describe("keydownToBytes: Alt+digit", () => {
  test("Alt+1 sends ESC prefix (the standard meta encoding)", () => {
    expect(keydownToBytes(e("1", { altKey: true }))).toBe("\x1b1");
  });
  test("Alt+9 sends ESC+9", () => {
    expect(keydownToBytes(e("9", { altKey: true }))).toBe("\x1b9");
  });
});

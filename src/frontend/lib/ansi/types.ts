/**
 * Structural types for xterm.js buffer cells and lines. The real
 * `@xterm/xterm` types satisfy these interfaces structurally, which lets the
 * renderer be unit-tested without instantiating a Terminal.
 */

/**
 * Color mode is exposed through predicate methods rather than `getFgColorMode`
 * integer comparisons. xterm's mode values are opaque packed bits
 * (`0x03000000 & fg`) — comparing against small ints like 1/2/3 silently
 * never matches, which strips every cell's color. The `isFg*` methods are
 * the stable, documented contract.
 */
export interface CellLike {
  getChars(): string;
  getWidth(): number;
  getFgColor(): number;
  getBgColor(): number;
  isFgDefault(): boolean;
  isFgPalette(): boolean;
  isFgRGB(): boolean;
  isBgDefault(): boolean;
  isBgPalette(): boolean;
  isBgRGB(): boolean;
  isBold(): number;
  isItalic(): number;
  isUnderline(): number;
  isDim(): number;
  isInverse(): number;
  isInvisible(): number;
  isBlink(): number;
  isStrikethrough(): number;
}

export interface BufferLineLike {
  readonly length: number;
  getCell(x: number, cell?: CellLike): CellLike | undefined;
}

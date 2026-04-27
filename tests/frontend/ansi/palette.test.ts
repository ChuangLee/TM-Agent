import { describe, expect, test } from "vitest";
import { ANSI_16, palette256, unpackRgb } from "../../../src/frontend/lib/ansi/palette.js";

describe("palette256", () => {
  test("returns the ANSI 16 hex for the low range", () => {
    for (let i = 0; i < 16; i++) {
      expect(palette256(i)).toBe(ANSI_16[i]);
    }
  });

  test("maps the 6x6x6 cube correctly at cube-corner 16", () => {
    expect(palette256(16)).toBe("#000000");
  });

  test("maps the 6x6x6 cube correctly at cube-corner 231", () => {
    expect(palette256(231)).toBe("#ffffff");
  });

  test("maps grayscale ramp at 232", () => {
    expect(palette256(232)).toBe("#080808");
  });

  test("maps grayscale ramp at 255", () => {
    expect(palette256(255)).toBe("#eeeeee");
  });

  test("pads each hex component to two digits", () => {
    expect(palette256(17)).toBe("#00005f");
  });
});

describe("unpackRgb", () => {
  test("splits packed integer into two-digit hex", () => {
    expect(unpackRgb(0x000000)).toBe("#000000");
    expect(unpackRgb(0xffffff)).toBe("#ffffff");
    expect(unpackRgb(0x010203)).toBe("#010203");
    expect(unpackRgb(0xff0000)).toBe("#ff0000");
  });
});

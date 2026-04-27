import { describe, expect, test } from "vitest";
import { formatRelativeTime } from "../../../src/frontend/lib/format-relative-time.js";

describe("formatRelativeTime", () => {
  const now = 2_000_000;

  test("returns empty string for undefined input", () => {
    expect(formatRelativeTime(undefined, now)).toBe("");
    expect(formatRelativeTime(NaN, now)).toBe("");
  });

  test("seconds bucket for deltas under a minute", () => {
    expect(formatRelativeTime(now - 0, now)).toBe("0s");
    expect(formatRelativeTime(now - 15, now)).toBe("15s");
    expect(formatRelativeTime(now - 59, now)).toBe("59s");
  });

  test("minutes bucket", () => {
    expect(formatRelativeTime(now - 60, now)).toBe("1m");
    expect(formatRelativeTime(now - 900, now)).toBe("15m");
    expect(formatRelativeTime(now - 3599, now)).toBe("59m");
  });

  test("hours bucket", () => {
    expect(formatRelativeTime(now - 3600, now)).toBe("1h");
    expect(formatRelativeTime(now - 86_399, now)).toBe("23h");
  });

  test("days and weeks", () => {
    expect(formatRelativeTime(now - 86_400, now)).toBe("1d");
    expect(formatRelativeTime(now - 604_799, now)).toBe("6d");
    expect(formatRelativeTime(now - 604_800, now)).toBe("1w");
  });

  test("empty after ~30 days — stale enough not to tell", () => {
    expect(formatRelativeTime(now - 2_592_001, now)).toBe("");
  });

  test("future timestamps clamp to zero", () => {
    expect(formatRelativeTime(now + 1000, now)).toBe("0s");
  });
});

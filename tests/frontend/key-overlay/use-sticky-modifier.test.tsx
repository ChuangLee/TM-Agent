// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useStickyModifiers } from "../../../src/frontend/features/key-overlay/use-sticky-modifier.js";

describe("useStickyModifiers", () => {
  test("all modifiers start idle", () => {
    const { result } = renderHook(() => useStickyModifiers());
    expect(result.current.state).toEqual({
      ctrl: "idle",
      alt: "idle",
      shift: "idle",
      meta: "idle"
    });
  });

  test("tap arms an idle modifier", () => {
    const { result } = renderHook(() => useStickyModifiers());
    act(() => result.current.tap("ctrl"));
    expect(result.current.state.ctrl).toBe("armed");
  });

  test("tap on armed modifier releases to idle", () => {
    const { result } = renderHook(() => useStickyModifiers());
    act(() => result.current.tap("ctrl"));
    act(() => result.current.tap("ctrl"));
    expect(result.current.state.ctrl).toBe("idle");
  });

  test("long-press locks an idle modifier", () => {
    const { result } = renderHook(() => useStickyModifiers());
    act(() => result.current.longPress("alt"));
    expect(result.current.state.alt).toBe("locked");
  });

  test("long-press on armed upgrades to locked", () => {
    const { result } = renderHook(() => useStickyModifiers());
    act(() => result.current.tap("shift"));
    act(() => result.current.longPress("shift"));
    expect(result.current.state.shift).toBe("locked");
  });

  test("long-press on locked releases to idle", () => {
    const { result } = renderHook(() => useStickyModifiers());
    act(() => result.current.longPress("meta"));
    act(() => result.current.longPress("meta"));
    expect(result.current.state.meta).toBe("idle");
  });

  test("tap on locked releases to idle", () => {
    const { result } = renderHook(() => useStickyModifiers());
    act(() => result.current.longPress("ctrl"));
    act(() => result.current.tap("ctrl"));
    expect(result.current.state.ctrl).toBe("idle");
  });

  test("consume returns active keys and resets armed to idle", () => {
    const { result } = renderHook(() => useStickyModifiers());
    act(() => result.current.tap("ctrl"));
    act(() => result.current.tap("alt"));
    let consumed: ReturnType<typeof result.current.consume> = [];
    act(() => {
      consumed = result.current.consume();
    });
    expect(new Set(consumed)).toEqual(new Set(["ctrl", "alt"]));
    expect(result.current.state.ctrl).toBe("idle");
    expect(result.current.state.alt).toBe("idle");
  });

  test("consume preserves locked modifiers", () => {
    const { result } = renderHook(() => useStickyModifiers());
    act(() => result.current.longPress("ctrl"));
    act(() => result.current.tap("alt"));
    let consumed: ReturnType<typeof result.current.consume> = [];
    act(() => {
      consumed = result.current.consume();
    });
    expect(new Set(consumed)).toEqual(new Set(["ctrl", "alt"]));
    expect(result.current.state.ctrl).toBe("locked");
    expect(result.current.state.alt).toBe("idle");
  });

  test("consume with no active modifiers returns empty array", () => {
    const { result } = renderHook(() => useStickyModifiers());
    let consumed: ReturnType<typeof result.current.consume> = [];
    act(() => {
      consumed = result.current.consume();
    });
    expect(consumed).toEqual([]);
  });

  test("each modifier is independent", () => {
    const { result } = renderHook(() => useStickyModifiers());
    act(() => result.current.tap("ctrl"));
    act(() => result.current.longPress("alt"));
    expect(result.current.state.ctrl).toBe("armed");
    expect(result.current.state.alt).toBe("locked");
    expect(result.current.state.shift).toBe("idle");
    expect(result.current.state.meta).toBe("idle");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSlotFocusShortcuts } from "../../../src/frontend/hooks/use-slot-focus-shortcuts.js";
import { useLayoutStore } from "../../../src/frontend/stores/layout-store.js";

const fireKey = (key: string, opts: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent("keydown", { key, ...opts, bubbles: true });
  window.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  localStorage.clear();
  useLayoutStore.setState({
    mode: 1,
    slots: [{ id: 0, attachedSession: null }],
    focusedSlot: 0
  });
});

afterEach(() => {
  // Force unmount in case of leaks across tests.
  useLayoutStore.setState({
    mode: 1,
    slots: [{ id: 0, attachedSession: null }],
    focusedSlot: 0
  });
});

describe("useSlotFocusShortcuts", () => {
  test("Ctrl+2 in 2-cols mode focuses slot 1", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "alpha" },
        { id: 1, attachedSession: "beta" }
      ],
      focusedSlot: 0
    });
    renderHook(() => useSlotFocusShortcuts());
    fireKey("2", { ctrlKey: true });
    expect(useLayoutStore.getState().focusedSlot).toBe(1);
  });

  test("Ctrl+4 in Quad mode focuses slot 3", () => {
    useLayoutStore.setState({
      mode: 4,
      slots: [
        { id: 0, attachedSession: "a" },
        { id: 1, attachedSession: "b" },
        { id: 2, attachedSession: "c" },
        { id: 3, attachedSession: "d" }
      ],
      focusedSlot: 0
    });
    renderHook(() => useSlotFocusShortcuts());
    fireKey("4", { ctrlKey: true });
    expect(useLayoutStore.getState().focusedSlot).toBe(3);
  });

  test("Cmd+1 (metaKey) also works for macOS users", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "a" },
        { id: 1, attachedSession: "b" }
      ],
      focusedSlot: 1
    });
    renderHook(() => useSlotFocusShortcuts());
    fireKey("1", { metaKey: true });
    expect(useLayoutStore.getState().focusedSlot).toBe(0);
  });

  test("Ctrl+3 in 2-cols mode is ignored (slot 2 doesn't exist)", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "a" },
        { id: 1, attachedSession: "b" }
      ],
      focusedSlot: 0
    });
    renderHook(() => useSlotFocusShortcuts());
    fireKey("3", { ctrlKey: true });
    expect(useLayoutStore.getState().focusedSlot).toBe(0);
  });

  test("Ctrl+2 in single mode is a no-op (no other slot)", () => {
    renderHook(() => useSlotFocusShortcuts());
    fireKey("2", { ctrlKey: true });
    expect(useLayoutStore.getState().focusedSlot).toBe(0);
    // mode unchanged
    expect(useLayoutStore.getState().mode).toBe(1);
  });

  test("Ctrl+Shift+2 is ignored (modifier combo)", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "a" },
        { id: 1, attachedSession: "b" }
      ],
      focusedSlot: 0
    });
    renderHook(() => useSlotFocusShortcuts());
    fireKey("2", { ctrlKey: true, shiftKey: true });
    expect(useLayoutStore.getState().focusedSlot).toBe(0);
  });

  test("Ctrl+2 inside an INPUT element is ignored", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "a" },
        { id: 1, attachedSession: "b" }
      ],
      focusedSlot: 0
    });
    const input = document.createElement("input");
    document.body.appendChild(input);
    renderHook(() => useSlotFocusShortcuts());
    const e = new KeyboardEvent("keydown", {
      key: "2",
      ctrlKey: true,
      bubbles: true
    });
    input.dispatchEvent(e);
    expect(useLayoutStore.getState().focusedSlot).toBe(0);
    document.body.removeChild(input);
  });

  test("hook unmount removes the listener", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "a" },
        { id: 1, attachedSession: "b" }
      ],
      focusedSlot: 0
    });
    const { unmount } = renderHook(() => useSlotFocusShortcuts());
    unmount();
    fireKey("2", { ctrlKey: true });
    expect(useLayoutStore.getState().focusedSlot).toBe(0);
  });
});

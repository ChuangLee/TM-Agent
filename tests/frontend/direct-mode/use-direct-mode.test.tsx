// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDirectMode } from "../../../src/frontend/features/direct-mode/use-direct-mode.js";

function resetGlobals(): void {
  window.history.replaceState(null, "", "/");
  // Force matchMedia to report desktop.
  window.matchMedia = ((q: string) => ({
    matches: /min-width: 820/.test(q) || /pointer: fine/.test(q),
    media: q,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn()
  })) as typeof window.matchMedia;
}

beforeEach(resetGlobals);
afterEach(resetGlobals);

describe("useDirectMode", () => {
  test("initial status is idle and not active", () => {
    const { result } = renderHook(() => useDirectMode({ onSendBytes: () => {} }));
    expect(result.current.status).toBe("idle");
    expect(result.current.active).toBe(false);
  });

  test("available=true on desktop matchMedia match", () => {
    const { result } = renderHook(() => useDirectMode({ onSendBytes: () => {} }));
    expect(result.current.available).toBe(true);
  });

  test("enter() transitions idle → active (200ms animation)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDirectMode({ onSendBytes: () => {} }));
    act(() => result.current.enter());
    expect(result.current.status).toBe("entering");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.status).toBe("active");
    expect(result.current.active).toBe(true);
  });

  test("exit() transitions active → idle", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDirectMode({ onSendBytes: () => {} }));
    act(() => result.current.enter());
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.exit("button"));
    expect(result.current.status).toBe("exiting");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.status).toBe("idle");
    expect(result.current.active).toBe(false);
  });

  test("toggle flips between idle and active", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDirectMode({ onSendBytes: () => {} }));
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.active).toBe(true);
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.active).toBe(false);
  });

  test("active: keydown forwards bytes to onSendBytes", () => {
    vi.useFakeTimers();
    const onSendBytes = vi.fn();
    const { result } = renderHook(() => useDirectMode({ onSendBytes }));
    act(() => result.current.enter());
    act(() => vi.advanceTimersByTime(200));

    const evt = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(evt);
    expect(onSendBytes).toHaveBeenCalledWith("a");
  });

  test("Ctrl+] intercepted as exit signal, NOT forwarded", () => {
    vi.useFakeTimers();
    const onSendBytes = vi.fn();
    const { result } = renderHook(() => useDirectMode({ onSendBytes }));
    act(() => result.current.enter());
    act(() => vi.advanceTimersByTime(200));

    const evt = new KeyboardEvent("keydown", {
      key: "]",
      code: "BracketRight",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    act(() => {
      document.dispatchEvent(evt);
    });

    expect(onSendBytes).not.toHaveBeenCalled();
    expect(result.current.status).toBe("exiting");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.active).toBe(false);
  });

  test("Shift+Esc triggers exit, NOT forwarded", () => {
    vi.useFakeTimers();
    const onSendBytes = vi.fn();
    const { result } = renderHook(() => useDirectMode({ onSendBytes }));
    act(() => result.current.enter());
    act(() => vi.advanceTimersByTime(200));

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          shiftKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });

    expect(onSendBytes).not.toHaveBeenCalled();
    expect(result.current.status).toBe("exiting");
  });

  test("plain Esc forwards as \\x1b and does NOT exit (even repeated)", () => {
    vi.useFakeTimers();
    const onSendBytes = vi.fn();
    const { result } = renderHook(() => useDirectMode({ onSendBytes }));
    act(() => result.current.enter());
    act(() => vi.advanceTimersByTime(200));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(50));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onSendBytes).toHaveBeenCalledTimes(2);
    expect(onSendBytes).toHaveBeenNthCalledWith(1, "\x1b");
    expect(onSendBytes).toHaveBeenNthCalledWith(2, "\x1b");
    expect(result.current.active).toBe(true);
  });

  test("Cmd+C / Ctrl+Shift+C are NOT forwarded (browser copy)", () => {
    vi.useFakeTimers();
    const onSendBytes = vi.fn();
    const { result } = renderHook(() => useDirectMode({ onSendBytes }));
    act(() => result.current.enter());
    act(() => vi.advanceTimersByTime(200));

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "c",
        metaKey: true,
        bubbles: true,
        cancelable: true
      })
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "C",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
    );

    expect(onSendBytes).not.toHaveBeenCalled();
  });

  test("plain Ctrl+C STILL forwards as SIGINT (0x03)", () => {
    vi.useFakeTimers();
    const onSendBytes = vi.fn();
    const { result } = renderHook(() => useDirectMode({ onSendBytes }));
    act(() => result.current.enter());
    act(() => vi.advanceTimersByTime(200));

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );
    expect(onSendBytes).toHaveBeenCalledWith("\x03");
  });

  test("paste event forwards clipboard text as bytes with CR normalization", () => {
    vi.useFakeTimers();
    const onSendBytes = vi.fn();
    const { result } = renderHook(() => useDirectMode({ onSendBytes }));
    act(() => result.current.enter());
    act(() => vi.advanceTimersByTime(200));

    // jsdom lacks DataTransfer; hand-roll a ClipboardEvent with a stub
    // clipboardData object that only needs the getData method we call.
    const evt = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "clipboardData", {
      value: { getData: (t: string) => (t === "text/plain" ? "line1\r\nline2\nline3" : "") }
    });
    act(() => {
      document.dispatchEvent(evt);
    });
    expect(onSendBytes).toHaveBeenCalledWith("line1\rline2\rline3");
  });

  test("idle state: keydown is NOT captured", () => {
    const onSendBytes = vi.fn();
    renderHook(() => useDirectMode({ onSendBytes }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(onSendBytes).not.toHaveBeenCalled();
  });
});

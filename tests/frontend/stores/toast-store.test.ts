// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useToastStore } from "../../../src/frontend/stores/toast-store.js";

describe("toast-store", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("push appends a toast with an auto-generated id", () => {
    useToastStore.getState().push({ kind: "info", message: "hi" });
    const { toasts } = useToastStore.getState();
    expect(toasts.length).toBe(1);
    expect(toasts[0]?.kind).toBe("info");
    expect(toasts[0]?.message).toBe("hi");
    expect(typeof toasts[0]?.id).toBe("string");
    expect(toasts[0]?.id.length).toBeGreaterThan(0);
  });

  test("auto-dismiss fires after the default duration", () => {
    useToastStore.getState().push({ kind: "success", message: "done" });
    expect(useToastStore.getState().toasts.length).toBe(1);
    vi.advanceTimersByTime(2500);
    expect(useToastStore.getState().toasts.length).toBe(0);
  });

  test("custom duration controls dismiss timing", () => {
    useToastStore.getState().push({ kind: "error", message: "boom", durationMs: 800 });
    vi.advanceTimersByTime(799);
    expect(useToastStore.getState().toasts.length).toBe(1);
    vi.advanceTimersByTime(2);
    expect(useToastStore.getState().toasts.length).toBe(0);
  });

  test("durationMs: 0 keeps the toast until manually dismissed", () => {
    useToastStore.getState().push({ id: "sticky", kind: "error", message: "boom", durationMs: 0 });
    vi.advanceTimersByTime(10_000);
    expect(useToastStore.getState().toasts.length).toBe(1);
    useToastStore.getState().dismiss("sticky");
    expect(useToastStore.getState().toasts.length).toBe(0);
  });

  test("dismiss removes the toast by id", () => {
    useToastStore.getState().push({ id: "a", kind: "info", message: "a" });
    useToastStore.getState().push({ id: "b", kind: "info", message: "b" });
    useToastStore.getState().dismiss("a");
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual(["b"]);
  });
});

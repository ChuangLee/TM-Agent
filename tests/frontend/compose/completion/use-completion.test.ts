// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useCompletion } from "../../../../src/frontend/features/compose/completion/use-completion.js";
import type { ShellState } from "../../../../src/frontend/features/shell-state/state-definitions.js";

function setup(initial: {
  value: string;
  shellState: ShellState;
  paneCurrentCommand?: string;
  disabled?: boolean;
}) {
  return renderHook((props: Parameters<typeof useCompletion>[0]) => useCompletion(props), {
    initialProps: {
      value: initial.value,
      shellState: initial.shellState,
      paneCurrentCommand: initial.paneCurrentCommand ?? "bash",
      disabled: initial.disabled ?? false
    }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCompletion (PR1 — `/` trigger only)", () => {
  test("opens on `/` in shell_idle", () => {
    const { result } = setup({ value: "/", shellState: "shell_idle" });
    expect(result.current.active).toBe(true);
    expect(result.current.entries.length).toBeGreaterThan(0);
    expect(result.current.highlightIndex).toBe(0);
  });

  test("does not open in states outside the whitelist", () => {
    const { result } = setup({ value: "/", shellState: "editor" });
    expect(result.current.active).toBe(false);
  });

  test("does not open in privacy states", () => {
    const { result } = setup({ value: "/", shellState: "password_prompt" });
    expect(result.current.active).toBe(false);
  });

  test("shellState change while active does NOT change the bucket (locked)", () => {
    const { result, rerender } = setup({
      value: "/",
      shellState: "shell_idle"
    });
    expect(result.current.active).toBe(true);
    const firstEntries = result.current.entries;

    rerender({
      value: "/",
      shellState: "tui",
      paneCurrentCommand: "bash",
      disabled: false
    });
    expect(result.current.active).toBe(true);
    // Locked bucket is (/, shell_idle), so entries must not flip to the tui bucket.
    expect(result.current.entries).toEqual(firstEntries);
  });

  test("entering privacy state while active force-closes", () => {
    const { result, rerender } = setup({
      value: "/",
      shellState: "shell_idle"
    });
    expect(result.current.active).toBe(true);
    rerender({
      value: "/",
      shellState: "password_prompt",
      paneCurrentCommand: "bash",
      disabled: false
    });
    expect(result.current.active).toBe(false);
  });

  test("deleting the trigger closes", () => {
    const { result, rerender } = setup({
      value: "/",
      shellState: "shell_idle"
    });
    expect(result.current.active).toBe(true);

    rerender({
      value: "",
      shellState: "shell_idle",
      paneCurrentCommand: "bash",
      disabled: false
    });
    expect(result.current.active).toBe(false);
  });

  test("prefix matches for typed input rank first", () => {
    const { result, rerender } = setup({
      value: "/",
      shellState: "shell_idle"
    });
    expect(result.current.active).toBe(true);
    rerender({
      value: "/cl",
      shellState: "shell_idle",
      paneCurrentCommand: "bash",
      disabled: false
    });
    // With fuzzy matching, subsequence hits can also appear (e.g. `clear`
    // via c-l or non-prefix entries containing c..l). What we guarantee is
    // that all prefix matches sort above any non-prefix match.
    const entries = result.current.entries;
    expect(entries.length).toBeGreaterThan(0);
    const firstNonPrefix = entries.findIndex((e) => !e.label.toLowerCase().startsWith("cl"));
    const lastPrefix = (() => {
      let last = -1;
      entries.forEach((e, i) => {
        if (e.label.toLowerCase().startsWith("cl")) last = i;
      });
      return last;
    })();
    if (firstNonPrefix !== -1 && lastPrefix !== -1) {
      expect(lastPrefix).toBeLessThan(firstNonPrefix);
    }
    expect(entries.some((e) => e.label === "claude")).toBe(true);
  });

  test("disabled closes and refuses to reopen", () => {
    const { result, rerender } = setup({
      value: "/",
      shellState: "shell_idle",
      disabled: true
    });
    expect(result.current.active).toBe(false);

    rerender({
      value: "/",
      shellState: "shell_idle",
      paneCurrentCommand: "bash",
      disabled: false
    });
    expect(result.current.active).toBe(true);
  });

  test("dismiss('esc') stays dismissed while trigger remains", () => {
    const { result, rerender } = setup({
      value: "/",
      shellState: "shell_idle"
    });
    expect(result.current.active).toBe(true);

    act(() => result.current.dismiss("esc"));
    expect(result.current.active).toBe(false);

    // Same value + state should NOT re-open — suppressed until trigger cleared.
    rerender({
      value: "/cl",
      shellState: "shell_idle",
      paneCurrentCommand: "bash",
      disabled: false
    });
    expect(result.current.active).toBe(false);

    // Clear the trigger → suppression lifts.
    rerender({
      value: "",
      shellState: "shell_idle",
      paneCurrentCommand: "bash",
      disabled: false
    });
    // Type a new trigger → re-opens.
    rerender({
      value: "/",
      shellState: "shell_idle",
      paneCurrentCommand: "bash",
      disabled: false
    });
    expect(result.current.active).toBe(true);
  });

  test("moveHighlight wraps circularly", () => {
    const { result } = setup({ value: "/", shellState: "shell_idle" });
    const n = result.current.entries.length;
    expect(n).toBeGreaterThan(1);

    act(() => result.current.moveHighlight(1));
    expect(result.current.highlightIndex).toBe(1);

    act(() => result.current.moveHighlight(-2));
    expect(result.current.highlightIndex).toBe(n - 1);
  });
});

describe("useCompletion — bare-trigger (no sigil)", () => {
  test("does not open on 1-char input", () => {
    const { result } = setup({ value: "c", shellState: "shell_idle" });
    expect(result.current.active).toBe(false);
  });

  test("opens in shell_idle once ≥2 chars match a starter", () => {
    const { result } = setup({ value: "cl", shellState: "shell_idle" });
    expect(result.current.active).toBe(true);
    expect(result.current.trigger).toBe("bare");
    expect(result.current.entries.some((e) => e.label.startsWith("claude"))).toBe(true);
  });

  test("refuses to open in tui state (those own their own grammar)", () => {
    const { result } = setup({ value: "cl", shellState: "tui" });
    expect(result.current.active).toBe(false);
  });

  test("refuses to open when no candidate would match", () => {
    // Nothing in the starter catalog or history starts with or contains-as-
    // subsequence "zzxxyy" in order — the popover must stay closed rather
    // than flashing an empty strip.
    const { result } = setup({ value: "zzxxyy", shellState: "shell_idle" });
    expect(result.current.active).toBe(false);
  });

  test("exposes trigger so callers can route Enter vs Tab differently", () => {
    const slash = setup({ value: "/", shellState: "shell_idle" });
    expect(slash.result.current.trigger).toBe("/");
    const bare = setup({ value: "git", shellState: "shell_idle" });
    expect(bare.result.current.trigger).toBe("bare");
  });
});

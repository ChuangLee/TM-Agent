import { describe, expect, test } from "vitest";
import {
  CATALOG,
  MAX_ENTRIES,
  filterEntries,
  resolveBucket
} from "../../../../src/frontend/features/compose/completion/catalog.js";

describe("resolveBucket", () => {
  test("fallback when (trigger,state) has no cmd requirement", () => {
    const bucket = resolveBucket("/", "shell_idle", "bash");
    expect(bucket).not.toBeNull();
    expect(bucket!.trigger).toBe("/");
    expect(bucket!.state).toBe("shell_idle");
    expect(bucket!.entries[0]?.insert).toBe("claude");
  });

  test("returns null when no bucket matches", () => {
    // editor+: is PR2 territory.
    expect(resolveBucket("/", "editor", "vim")).toBeNull();
    expect(resolveBucket(":", "shell_idle", "bash")).toBeNull();
  });

  test("tui+claude resolves to the Claude Code bucket", () => {
    const bucket = resolveBucket("/", "tui", "claude");
    expect(bucket).not.toBeNull();
    expect(bucket!.cmd).toBe("claude");
    expect(bucket!.entries.some((e) => e.label === "help")).toBe(true);
    // Insert must keep the leading slash — Claude Code parses `/help` itself.
    expect(bucket!.entries.find((e) => e.label === "help")?.insert).toBe("/help");
  });

  test("tui+codex resolves to the Codex bucket, distinct from Claude's", () => {
    const claude = resolveBucket("/", "tui", "claude")!;
    const codex = resolveBucket("/", "tui", "codex")!;
    expect(codex.cmd).toBe("codex");
    expect(codex).not.toBe(claude);
    expect(codex.entries.some((e) => e.label === "fork")).toBe(true);
  });

  test("tui+aider resolves to the aider bucket", () => {
    const bucket = resolveBucket("/", "tui", "aider");
    expect(bucket).not.toBeNull();
    expect(bucket!.cmd).toBe("aider");
    expect(bucket!.entries.some((e) => e.label === "add")).toBe(true);
  });

  test("tui with unknown cmd does NOT fall back to another cmd-scoped bucket", () => {
    // No TUI fallback bucket exists; htop / lazygit users get nothing.
    expect(resolveBucket("/", "tui", "htop")).toBeNull();
  });

  test("every TUI entry's insert keeps its leading slash", () => {
    for (const b of CATALOG) {
      if (b.state !== "tui") continue;
      for (const e of b.entries) {
        expect(e.insert.startsWith("/")).toBe(true);
        expect(e.label.startsWith("/")).toBe(false);
      }
    }
  });
});

describe("filterEntries", () => {
  const entries = CATALOG[0]!.entries;

  test("empty prefix returns all up to MAX_ENTRIES", () => {
    const out = filterEntries(entries, "");
    expect(out.length).toBe(Math.min(entries.length, MAX_ENTRIES));
  });

  test("prefix matches rank above subsequence matches", () => {
    const out = filterEntries(entries, "CL");
    // Prefix matches (labels starting with "cl") must appear before any
    // non-prefix match. The fuzzy tier is still allowed to contribute below.
    const firstNonPrefix = out.findIndex((e) => !e.label.toLowerCase().startsWith("cl"));
    const lastPrefix = (() => {
      let last = -1;
      out.forEach((e, i) => {
        if (e.label.toLowerCase().startsWith("cl")) last = i;
      });
      return last;
    })();
    if (firstNonPrefix !== -1 && lastPrefix !== -1) {
      expect(lastPrefix).toBeLessThan(firstNonPrefix);
    }
    expect(out.some((e) => e.label === "claude")).toBe(true);
    expect(out.some((e) => e.label === "claude --resume")).toBe(true);
  });

  test("no-match query returns empty", () => {
    // "zzzz" matches nothing by prefix OR subsequence.
    expect(filterEntries(entries, "zzzz")).toEqual([]);
  });

  test("subsequence fuzzy matches surface non-prefix candidates", () => {
    const out = filterEntries(entries, "gtd");
    expect(out.some((e) => e.label === "git diff")).toBe(true);
  });

  test("caps at MAX_ENTRIES even when more match", () => {
    // Fabricate a wide list; filter returns no more than MAX_ENTRIES.
    const wide = Array.from({ length: 20 }, (_, i) => ({
      label: `cmd-${i}`,
      insert: `cmd-${i}`
    }));
    expect(filterEntries(wide, "cmd").length).toBe(MAX_ENTRIES);
  });
});

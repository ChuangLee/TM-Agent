import { describe, expect, test } from "vitest";
import {
  classify,
  LONG_PROCESS_IDLE_MS
} from "../../../src/frontend/features/shell-state/classifier.js";
import type { Signals } from "../../../src/frontend/features/shell-state/classifier.js";
import type { ShellState } from "../../../src/frontend/features/shell-state/state-definitions.js";

const NOW = 1_700_000_000_000;

function signals(partial: Partial<Signals>): Signals {
  return {
    cmd: "",
    altScreen: false,
    tail: "",
    lastOutputTs: NOW - LONG_PROCESS_IDLE_MS * 2, // quiet by default
    now: NOW,
    ...partial
  };
}

interface Case {
  name: string;
  input: Partial<Signals>;
  expected: ShellState;
  highConfidence?: boolean;
}

const CASES: Case[] = [
  // ── password_prompt (takes precedence over everything else) ──
  {
    name: "sudo password prompt",
    input: { tail: "[sudo] password for user: " },
    expected: "password_prompt",
    highConfidence: true
  },
  {
    name: "ssh passphrase",
    input: { tail: "Enter passphrase for key /root/.ssh/id_ed25519: " },
    expected: "password_prompt",
    highConfidence: true
  },
  {
    name: "plain Password: prompt",
    input: { tail: "Password: ", cmd: "ssh" },
    expected: "password_prompt",
    highConfidence: true
  },
  {
    name: "PASSWORD: (uppercase) matches case-insensitively",
    input: { tail: "PASSWORD: " },
    expected: "password_prompt",
    highConfidence: true
  },

  // ── confirm_prompt ──
  {
    name: "[Y/n] uppercase default",
    input: { tail: "Do you want to continue? [Y/n] " },
    expected: "confirm_prompt",
    highConfidence: true
  },
  {
    name: "[y/N] lowercase default",
    input: { tail: "Proceed with installation? [y/N] " },
    expected: "confirm_prompt",
    highConfidence: true
  },
  {
    name: "(yes/no) long form",
    input: { tail: "Remove file? (yes/no) " },
    expected: "confirm_prompt",
    highConfidence: true
  },
  {
    name: "plain Continue?",
    input: { tail: "Continue? " },
    expected: "confirm_prompt",
    highConfidence: true
  },
  {
    name: "(y/n) paren short form",
    input: { tail: "Overwrite existing file? (y/n) " },
    expected: "confirm_prompt",
    highConfidence: true
  },
  {
    name: "Are you sure?",
    input: { tail: "Are you sure you want to continue? [Y/n] " },
    expected: "confirm_prompt",
    highConfidence: true
  },

  // ── editor ──
  {
    name: "vim alt-screen",
    input: { cmd: "vim", altScreen: true, tail: "-- INSERT --" },
    expected: "editor",
    highConfidence: true
  },
  {
    name: "nvim alt-screen",
    input: { cmd: "nvim", altScreen: true },
    expected: "editor",
    highConfidence: true
  },
  {
    name: "nano alt-screen",
    input: { cmd: "nano", altScreen: true },
    expected: "editor",
    highConfidence: true
  },
  {
    name: "helix (hx) alt-screen",
    input: { cmd: "hx", altScreen: true },
    expected: "editor",
    highConfidence: true
  },

  // ── pager ──
  {
    name: "less alt-screen",
    input: { cmd: "less", altScreen: true, tail: ":" },
    expected: "pager",
    highConfidence: true
  },
  {
    name: "man alt-screen",
    input: { cmd: "man", altScreen: true },
    expected: "pager",
    highConfidence: true
  },
  {
    name: "git spawns pager",
    input: { cmd: "git", altScreen: true },
    expected: "pager",
    highConfidence: true
  },

  // ── tui ──
  {
    name: "claude full-screen",
    input: { cmd: "claude", altScreen: true },
    expected: "tui",
    highConfidence: true
  },
  // Claude Code in default (non-fullscreen) mode paints in the main screen
  // even while the user is interacting with it — altScreen=false, but still
  // a TUI. Completion's `/` trigger needs this path to resolve to tui.
  {
    name: "claude default-mode main screen",
    input: { cmd: "claude", altScreen: false, tail: "⠂ Review roadmap" },
    expected: "tui",
    highConfidence: true
  },
  {
    name: "codex main screen",
    input: { cmd: "codex", altScreen: false },
    expected: "tui",
    highConfidence: true
  },
  { name: "htop", input: { cmd: "htop", altScreen: true }, expected: "tui", highConfidence: true },
  {
    name: "lazygit",
    input: { cmd: "lazygit", altScreen: true },
    expected: "tui",
    highConfidence: true
  },
  {
    name: "unknown alt-screen command falls to tui (low conf)",
    input: { cmd: "weirdapp", altScreen: true },
    expected: "tui",
    highConfidence: false
  },

  // ── repl ──
  {
    name: "python REPL via cmd",
    input: { cmd: "python3", tail: ">>> " },
    expected: "repl",
    highConfidence: true
  },
  {
    name: "node REPL via cmd",
    input: { cmd: "node", tail: "> " },
    expected: "repl",
    highConfidence: true
  },
  {
    name: "ipython via prompt regex",
    input: { cmd: "ipython", tail: "In [3]: " },
    expected: "repl",
    highConfidence: true
  },
  {
    name: "python multiline continuation",
    input: { cmd: "python3", tail: ">>> for x in range(10):\n...     " },
    expected: "repl",
    highConfidence: true
  },
  { name: "ghci Haskell", input: { cmd: "ghci" }, expected: "repl", highConfidence: true },

  // ── shell_idle ──
  {
    name: "bash simple prompt",
    input: { cmd: "bash", tail: "$ " },
    expected: "shell_idle",
    highConfidence: true
  },
  {
    name: "zsh with user@host",
    input: { cmd: "zsh", tail: "user@server ~ $ " },
    expected: "shell_idle",
    highConfidence: true
  },
  {
    name: "root # prompt",
    input: { cmd: "bash", tail: "root@host:/# " },
    expected: "shell_idle",
    highConfidence: true
  },
  {
    name: "fish ❯ prompt",
    input: { cmd: "fish", tail: "~ ❯ " },
    expected: "shell_idle",
    highConfidence: true
  },
  {
    name: "powershell PS C:\\> beats REPL regex because SHELL_CMDS wins",
    input: { cmd: "pwsh", tail: "PS C:\\> " },
    expected: "shell_idle",
    highConfidence: true
  },
  {
    name: "nushell",
    input: { cmd: "nu", tail: "~> " },
    expected: "shell_idle",
    highConfidence: true
  },
  {
    name: "empty tail but cmd=bash still shell_idle",
    input: { cmd: "bash", tail: "" },
    expected: "shell_idle",
    highConfidence: true
  },

  // ── long_process ──
  {
    name: "recent output within idle window → long_process",
    input: { tail: "Building... 24%", lastOutputTs: NOW - 500 },
    expected: "long_process",
    highConfidence: true
  },
  {
    name: "recent output but tail has prompt → shell_idle wins",
    input: { tail: "$ ", lastOutputTs: NOW - 500 },
    expected: "shell_idle",
    highConfidence: true
  },

  // ── fallback (low confidence) ──
  {
    name: "no signals → shell_idle low confidence",
    input: {},
    expected: "shell_idle",
    highConfidence: false
  }
];

describe("classify()", () => {
  for (const c of CASES) {
    test(c.name, () => {
      const result = classify(signals(c.input));
      expect(result.state, `tail=${JSON.stringify(c.input.tail)} cmd=${c.input.cmd ?? ""}`).toBe(
        c.expected
      );
      if (c.highConfidence !== undefined) {
        expect(result.confidence).toBe(c.highConfidence ? "high" : "low");
      }
      expect(result.detectedAt).toBe(NOW);
    });
  }

  test("tailSample and paneCurrentCommand are round-tripped", () => {
    const result = classify(signals({ cmd: "vim", altScreen: true, tail: "~\n~\n" }));
    expect(result.tailSample).toBe("~\n~\n");
    expect(result.paneCurrentCommand).toBe("vim");
    expect(result.altScreen).toBe(true);
  });

  test("password prompt takes precedence over confirm, alt-screen, cmd", () => {
    const result = classify(signals({ cmd: "vim", altScreen: true, tail: "Password: " }));
    expect(result.state).toBe("password_prompt");
  });

  test("confirm_prompt precedes alt-screen editor", () => {
    const result = classify(
      signals({ cmd: "vim", altScreen: true, tail: "Quit without saving? [y/N] " })
    );
    expect(result.state).toBe("confirm_prompt");
  });
});

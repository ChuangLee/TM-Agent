import {
  EDITOR_CMDS,
  PAGER_CMDS,
  REPL_CMDS,
  SHELL_CMDS,
  TUI_CMDS,
  type Confidence,
  type ShellState,
  type ShellStateResult
} from "./state-definitions.js";

export const PASSWORD_RE = /(password|passphrase).*:\s*$/i;
export const CONFIRM_RE =
  /(\[y\/n\]|\(y\/n\)|\(yes\/no\)|continue\?|proceed\?|remove\?|overwrite\?|are you sure\??)\s*$/i;
export const REPL_PROMPT_RE = /(^|\n)(>>>|\.\.\.|> |In \[\d+\]:?)\s*$/m;
export const PROMPT_RE = /[$›#»❯]\s*$/;

export const LONG_PROCESS_IDLE_MS = 3000;

export interface Signals {
  cmd: string;
  altScreen: boolean;
  tail: string;
  lastOutputTs: number;
  now: number;
}

export function classify(s: Signals): ShellStateResult {
  const make = (state: ShellState, confidence: Confidence): ShellStateResult => ({
    state,
    confidence,
    detectedAt: s.now,
    tailSample: s.tail,
    paneCurrentCommand: s.cmd,
    altScreen: s.altScreen
  });

  if (PASSWORD_RE.test(s.tail)) return make("password_prompt", "high");
  if (CONFIRM_RE.test(s.tail)) return make("confirm_prompt", "high");

  // TUI cmds (claude, codex, gemini, aider, htop, …) don't all use the
  // alt-screen: Claude Code in default mode paints a rich prompt in the main
  // screen, so `altScreen=false` on its own would misclassify it as
  // long_process. When cmd matches a known TUI, trust cmd over screen mode.
  if (TUI_CMDS.has(s.cmd)) return make("tui", "high");

  if (s.altScreen) {
    if (EDITOR_CMDS.has(s.cmd)) return make("editor", "high");
    if (PAGER_CMDS.has(s.cmd)) return make("pager", "high");
    // `git log` spawns `less` → tmux may report either during the transient.
    if (s.cmd === "git") return make("pager", "high");
    return make("tui", "low");
  }

  // Explicit shell — trust cmd over ambiguous prompt patterns (e.g. PowerShell
  // `PS C:\> ` ends with `> ` which also matches REPL_PROMPT_RE).
  if (SHELL_CMDS.has(s.cmd)) return make("shell_idle", "high");

  if (REPL_CMDS.has(s.cmd) || REPL_PROMPT_RE.test(s.tail)) {
    return make("repl", "high");
  }
  if (PROMPT_RE.test(s.tail)) return make("shell_idle", "high");
  if (s.now - s.lastOutputTs < LONG_PROCESS_IDLE_MS) {
    return make("long_process", "high");
  }
  return make("shell_idle", "low");
}

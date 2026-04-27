export const SHELL_STATES = [
  "shell_idle",
  "long_process",
  "editor",
  "tui",
  "repl",
  "pager",
  "confirm_prompt",
  "password_prompt"
] as const;

export type ShellState = (typeof SHELL_STATES)[number];
export type Confidence = "high" | "low";

export interface ShellStateResult {
  state: ShellState;
  confidence: Confidence;
  detectedAt: number;
  tailSample: string;
  paneCurrentCommand: string;
  altScreen: boolean;
}

export const SHELL_CMDS = new Set([
  "bash",
  "zsh",
  "fish",
  "sh",
  "dash",
  "ksh",
  "pwsh",
  "powershell",
  "nu",
  "nushell"
]);
export const EDITOR_CMDS = new Set(["vim", "nvim", "nano", "micro", "hx", "helix"]);
export const PAGER_CMDS = new Set(["less", "more", "man"]);
export const TUI_CMDS = new Set([
  "claude",
  "codex",
  "gemini",
  "hermes",
  "aider",
  "htop",
  "btop",
  "lazygit",
  "ranger",
  "fzf",
  "k9s",
  "tig",
  "gitui",
  "nmtui",
  "bluetoothctl"
]);
export const REPL_CMDS = new Set([
  "python",
  "python3",
  "node",
  "bun",
  "deno",
  "irb",
  "ghci",
  "lua"
]);

export function initialShellStateResult(): ShellStateResult {
  return {
    state: "shell_idle",
    confidence: "low",
    detectedAt: 0,
    tailSample: "",
    paneCurrentCommand: "",
    altScreen: false
  };
}

import type { ShellState } from "../shell-state/state-definitions.js";

export interface OverlayKey {
  label: string;
  payload: string;
}

/**
 * The small "state-contextual" band at the top of the KeyOverlay.
 * Mirrors the ActionPanel's state-specific vocabulary but with compact
 * keys and no learned history.
 */
export function contextualKeys(state: ShellState, cmd: string): OverlayKey[] {
  switch (state) {
    case "editor":
      if (cmd === "nano") {
        return [
          { label: "^O", payload: "\x0f" },
          { label: "^X", payload: "\x18" },
          { label: "^K", payload: "\x0b" },
          { label: "^W", payload: "\x17" }
        ];
      }
      return [
        { label: ":w", payload: ":w\r" },
        { label: ":q", payload: ":q\r" },
        { label: ":wq", payload: ":wq\r" },
        { label: "gg", payload: "gg" },
        { label: "G", payload: "G" },
        { label: "/", payload: "/" }
      ];
    case "tui":
      return [
        { label: "y", payload: "y" },
        { label: "n", payload: "n" },
        { label: "?", payload: "?" },
        { label: "/", payload: "/" }
      ];
    case "repl":
      return [
        { label: ".exit", payload: ".exit\r" },
        { label: ".help", payload: ".help\r" },
        { label: "↑", payload: "\x1b[A" },
        { label: "↓", payload: "\x1b[B" }
      ];
    case "pager":
      return [
        { label: "Space", payload: " " },
        { label: "b", payload: "b" },
        { label: "q", payload: "q" },
        { label: "/", payload: "/" },
        { label: "n", payload: "n" },
        { label: "G", payload: "G" },
        { label: "gg", payload: "gg" }
      ];
    case "long_process":
      return [{ label: "Ctrl+C", payload: "\x03" }];
    case "shell_idle":
      return [
        { label: "↑", payload: "\x1b[A" },
        { label: "↓", payload: "\x1b[B" },
        { label: "Tab", payload: "\t" },
        { label: "|", payload: "|" },
        { label: ">", payload: ">" }
      ];
    case "confirm_prompt":
    case "password_prompt":
      return [];
    default: {
      const _: never = state;
      return _;
    }
  }
}

/** F1..F12 → ANSI/xterm escape bytes. */
export function fnKeyPayload(n: number): string {
  if (n >= 1 && n <= 4) return "\x1bO" + "PQRS"[n - 1];
  const csiCodes = [15, 17, 18, 19, 20, 21, 23, 24]; // F5..F12
  return "\x1b[" + csiCodes[n - 5] + "~";
}

/**
 * Wrap a plain-character payload with a sticky modifier set. Mirrors the
 * core of `keydownToBytes` but for our already-resolved card payloads.
 */
export function applyModifiers(
  mods: readonly ("ctrl" | "alt" | "shift" | "meta")[],
  payload: string
): string {
  if (!mods.length) return payload;
  // Ctrl+<letter> → control char (0x01..0x1a) for a-z (case-insensitive).
  if (mods.includes("ctrl") && payload.length === 1 && /^[a-zA-Z]$/.test(payload)) {
    return String.fromCharCode(payload.toLowerCase().charCodeAt(0) - 96);
  }
  // Alt+<char> → ESC prefix (Meta encoding, Emacs-style).
  if (mods.includes("alt") && payload.length === 1) {
    return "\x1b" + payload;
  }
  // Shift: for letters we'd want uppercase, but our layout already uses
  // lowercase. Leave payload alone; rare in practice since the overlay
  // exposes only low-level keys.
  return payload;
}

import type { ShellState } from "../../shell-state/state-definitions.js";

/**
 * Completion trigger kinds:
 *   - `/` — slash command (Claude Code, Codex, aider …) or shell-idle catalog
 *   - `:` — vim/editor ex-command (reserved for PR2)
 *   - `bare` — no leading sigil; only activates in `shell_idle` after ≥2 chars
 *     and when something in the catalog/history starts with what's typed.
 *     Inspired by fish-shell autosuggestions + iOS QuickType strip — lets
 *     `clau` surface `claude --resume` without the user needing to type `/`
 *     first.
 */
export type Trigger = "/" | ":" | "bare";

export interface Entry {
  /** Primary text shown in the list, e.g. "claude --resume". */
  label: string;
  /**
   * Full textarea value after the user picks this entry. Overwrites — not
   * appended to — the current value.
   *
   * Convention — labels never include the trigger char (so prefix filtering
   * stays consistent across buckets), but `insert` keeps whatever the target
   * program actually expects:
   *   - `/` in `shell_idle`: insert is bare (`claude`, `git status`). The
   *     slash was the trigger only; bash never sees it.
   *   - `/` in `tui` (Claude Code, Codex, aider …): insert keeps the slash
   *     (`/help`, `/clear`) because the TUI's own slash-command parser does.
   *   - `:` (vim ex): insert keeps the colon for the same reason.
   */
  insert: string;
  /** Optional dim subtitle. */
  hint?: string;
}

export interface Bucket {
  trigger: Trigger;
  state: ShellState;
  /**
   * When set, this bucket only applies if `paneCurrentCommand` matches
   * exactly. Missing cmd = fallback for the (trigger, state) pair.
   */
  cmd?: string;
  entries: Entry[];
}

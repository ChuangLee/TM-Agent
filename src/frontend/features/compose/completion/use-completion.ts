import { useCallback, useEffect, useRef, useState } from "react";
import type { ShellState } from "../../shell-state/state-definitions.js";
import type { Entry, Trigger } from "./types.js";
import {
  filterEntries,
  mergeHistoryIntoEntries,
  resolveBucket,
  SHELL_IDLE_STATIC_ENTRIES
} from "./catalog.js";
import { useShellHistoryStore } from "../../../stores/shell-history-store.js";
import { debugLog } from "../../../lib/debug-log.js";

export interface UseCompletionInput {
  value: string;
  shellState: ShellState;
  paneCurrentCommand: string;
  /** When true (e.g. KeyOverlay is up), force-close and refuse to open. */
  disabled?: boolean;
}

/**
 * Minimum chars of input before `bare`-trigger (no leading sigil) completion
 * activates. Below this we'd noise up the keyboard for every keystroke; above
 * this the prefix is distinctive enough that the popover is useful.
 */
const BARE_MIN_CHARS = 2;

export interface UseCompletionReturn {
  active: boolean;
  entries: Entry[];
  highlightIndex: number;
  /** Which trigger class locked the popover — callers use this to decide
   *  whether Enter should pick (sigil triggers) or submit (bare trigger). */
  trigger: Trigger | null;
  moveHighlight(delta: number): void;
  setHighlight(index: number): void;
  dismiss(reason: "esc" | "outside" | "pick"): void;
}

type DismissReason = "esc" | "outside" | "pick" | "delete-trigger" | "state-locked";

const TRIGGER_WHITELIST: Record<Trigger, ReadonlySet<ShellState>> = {
  "/": new Set<ShellState>(["shell_idle", "tui"]),
  // `:` triggers are PR2 — keep the table here so the state machine is
  // symmetric, but the hook below only reacts to `/` for now.
  ":": new Set<ShellState>(["editor", "pager"]),
  // `bare` (no sigil) only makes sense at a shell prompt. `tui` apps already
  // have their own slash grammar, so we leave them alone.
  bare: new Set<ShellState>(["shell_idle"])
};

const ACTIVE_TRIGGERS: ReadonlySet<Trigger> = new Set(["/", "bare"]);

const PRIVACY_STATES: ReadonlySet<ShellState> = new Set(["password_prompt", "confirm_prompt"]);

/**
 * Classify the current input:
 *   - `/foo` / `:foo` → sigil trigger, filter = `foo`
 *   - plain `foo` of ≥ BARE_MIN_CHARS chars → bare trigger, filter = `foo`
 *   - anything shorter or with whitespace-only → null (no activation)
 */
function classifyInput(value: string): { trigger: Trigger; prefix: string } | null {
  const trimmed = value.trimStart();
  if (trimmed.length === 0) return null;
  const first = trimmed[0];
  if (first === "/" || first === ":") {
    return { trigger: first as Trigger, prefix: trimmed.slice(1) };
  }
  // Bare trigger requires at least BARE_MIN_CHARS and should not contain
  // a newline — multi-line drafts are not shell commands. We also stop at
  // the first space: "git sta" would have prefix "git sta" (full thing, not
  // "sta"), so the catalog's fuzzy matcher sees the full command shape.
  if (trimmed.length < BARE_MIN_CHARS) return null;
  if (trimmed.includes("\n")) return null;
  return { trigger: "bare", prefix: trimmed };
}

interface LockedState {
  trigger: Trigger;
  state: ShellState;
  cmd: string;
}

export function useCompletion(input: UseCompletionInput): UseCompletionReturn {
  const { value, shellState, paneCurrentCommand, disabled = false } = input;
  const historyEntries = useShellHistoryStore((s) => s.entries);

  const [locked, setLocked] = useState<LockedState | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  // When the user explicitly dismisses (esc / outside click / pick), suppress
  // re-activation until the leading trigger is removed from `value`.
  const [suppressed, setSuppressed] = useState(false);

  const dismiss = useCallback(
    (reason: DismissReason): void => {
      if (locked) {
        emit("dismiss", { ...locked, reason });
      }
      setLocked(null);
      setHighlightIndex(0);
      if (reason === "esc" || reason === "outside" || reason === "pick") {
        setSuppressed(true);
      }
    },
    [locked]
  );

  // Core derivation: run whenever value / shellState / disabled changes.
  useEffect(() => {
    if (disabled) {
      if (locked) dismiss("state-locked");
      return;
    }

    const classification = classifyInput(value);
    const currentTrigger = classification?.trigger ?? null;

    // Already locked — check the three exit conditions from tech-design §4.
    if (locked) {
      // a) Privacy state: force-close regardless of typed content.
      if (PRIVACY_STATES.has(shellState)) {
        dismiss("state-locked");
        return;
      }
      // b) Leading trigger was deleted or changed (incl. bare → sigil).
      if (currentTrigger !== locked.trigger) {
        dismiss("delete-trigger");
        return;
      }
      // c) Still matches — nothing to change here. Entries get recomputed
      //    below from `locked` snapshot + current `value` prefix.
      return;
    }

    // Not locked — figure out if we should activate.
    if (suppressed) {
      if (currentTrigger === null) setSuppressed(false);
      return;
    }
    if (classification === null) return;
    if (!ACTIVE_TRIGGERS.has(classification.trigger)) return;
    if (!TRIGGER_WHITELIST[classification.trigger].has(shellState)) return;
    if (PRIVACY_STATES.has(shellState)) return;
    const bucket = resolveBucket(classification.trigger, shellState, paneCurrentCommand);
    if (!bucket || bucket.entries.length === 0) return;

    // Bare-trigger extra guard: only open if we actually have a candidate
    // for the typed prefix. Otherwise every word the user types would pop
    // an empty strip in and out — much worse than no completion at all.
    if (classification.trigger === "bare") {
      const merged = mergeHistoryIntoEntries(bucket.entries, historyEntries);
      const preview = filterEntries(merged, classification.prefix);
      if (preview.length === 0) return;
    }

    const next: LockedState = {
      trigger: classification.trigger,
      state: shellState,
      cmd: paneCurrentCommand
    };
    setLocked(next);
    setHighlightIndex(0);
    emit("open", { ...next, count: bucket.entries.length });
  }, [
    value,
    shellState,
    paneCurrentCommand,
    disabled,
    locked,
    suppressed,
    dismiss,
    historyEntries
  ]);

  // Reset suppression when the user clears the leading trigger — so a fresh
  // `/` after an Esc-close will re-open.
  useEffect(() => {
    if (!suppressed) return;
    if (classifyInput(value) === null) setSuppressed(false);
  }, [value, suppressed]);

  // Derive visible entries from the locked bucket + live prefix. For
  // shell_idle we splice history entries in so host-local commands surface
  // alongside the curated starters.
  const entries = (() => {
    if (!locked) return EMPTY;
    const bucket = resolveBucket(locked.trigger, locked.state, locked.cmd);
    if (!bucket) return EMPTY;
    const sourceEntries =
      locked.state === "shell_idle"
        ? mergeHistoryIntoEntries(
            locked.trigger === "/" || locked.trigger === "bare"
              ? SHELL_IDLE_STATIC_ENTRIES
              : bucket.entries,
            historyEntries
          )
        : bucket.entries;
    const filterText =
      locked.trigger === "bare"
        ? value.trimStart()
        : // sigil trigger: drop the leading char
          value.trimStart().slice(1);
    return filterEntries(sourceEntries, filterText);
  })();

  // Keep highlight index in range when the filtered list shrinks.
  const clampedHighlight = entries.length === 0 ? 0 : Math.min(highlightIndex, entries.length - 1);
  const clampRef = useRef(clampedHighlight);
  if (clampRef.current !== clampedHighlight) {
    clampRef.current = clampedHighlight;
    // Defer — setState during render would loop.
    queueMicrotask(() => setHighlightIndex(clampedHighlight));
  }

  const moveHighlight = useCallback(
    (delta: number): void => {
      setHighlightIndex((prev) => {
        if (entries.length === 0) return 0;
        const next = (prev + delta + entries.length) % entries.length;
        return next;
      });
    },
    [entries.length]
  );

  const setHighlight = useCallback((index: number): void => {
    setHighlightIndex(index);
  }, []);

  const active = locked !== null && entries.length > 0;

  return {
    active,
    entries,
    highlightIndex: clampedHighlight,
    trigger: locked?.trigger ?? null,
    moveHighlight,
    setHighlight,
    dismiss
  };
}

const EMPTY: Entry[] = [];

function emit(event: "open" | "dismiss" | "pick", payload: unknown): void {
  debugLog("completion", event, { payload });
}

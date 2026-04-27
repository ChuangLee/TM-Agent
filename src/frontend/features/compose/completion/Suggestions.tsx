import { useEffect, type PointerEvent, type ReactElement } from "react";
import type { Entry } from "./types.js";

export interface SuggestionsProps {
  entries: Entry[];
  highlightIndex: number;
  onPick(entry: Entry): void;
  onHighlight(index: number): void;
  onDismiss(reason: "outside" | "esc"): void;
}

/**
 * Floating candidate list anchored above the ComposeBar textarea. Positioning
 * uses `position: absolute; bottom: 100%` relative to the ComposeBar root
 * (which is set to `position: relative` by its `tm-compose-wrap` class), so
 * this component renders purely by returning a `<ul>` — no portal, no layout
 * JS.
 */
export function Suggestions({
  entries,
  highlightIndex,
  onPick,
  onHighlight,
  onDismiss
}: SuggestionsProps): ReactElement | null {
  useEffect(() => {
    const handlePointer = (e: globalThis.PointerEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".tm-suggestions")) return;
      if (target.closest('[data-testid="compose-bar"]')) return;
      onDismiss("outside");
    };
    document.addEventListener("pointerdown", handlePointer, true);
    return () => document.removeEventListener("pointerdown", handlePointer, true);
  }, [onDismiss]);

  if (entries.length === 0) return null;

  const handlePick = (e: PointerEvent<HTMLLIElement>, entry: Entry): void => {
    // preventDefault keeps the textarea focused — otherwise mobile Safari
    // collapses the keyboard and the user has to tap again to keep typing.
    e.preventDefault();
    onPick(entry);
  };

  return (
    <ul
      className="tm-suggestions"
      role="listbox"
      aria-label="suggestions"
      data-testid="compose-suggestions"
    >
      {entries.map((entry, i) => (
        <li
          key={entry.label}
          role="option"
          aria-selected={i === highlightIndex}
          data-active={i === highlightIndex ? "true" : "false"}
          data-testid="compose-suggestion-item"
          onPointerDown={(e) => handlePick(e, entry)}
          onMouseEnter={() => onHighlight(i)}
        >
          <span className="tm-suggest-label">{entry.label}</span>
          {entry.hint != null && <span className="tm-suggest-hint">{entry.hint}</span>}
          <span className="tm-suggest-enter" aria-hidden="true">
            ⏎
          </span>
        </li>
      ))}
    </ul>
  );
}

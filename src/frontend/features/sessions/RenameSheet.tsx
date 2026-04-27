import { useEffect, useRef, useState, type ReactElement } from "react";
import { BottomSheet } from "../../components/BottomSheet.js";

export interface RenameSheetProps {
  open: boolean;
  onClose: () => void;
  /** Existing name — prefills the input. Pass "" for create-mode. */
  currentName: string;
  /** Sheet title (e.g. "Rename session main" or "New session"). */
  title: string;
  /** Label above the input. */
  label: string;
  /** Submit button text. Defaults to "Rename"; pass "Create" for create-mode. */
  submitLabel?: string;
  onSubmit: (newName: string) => void;
}

export function RenameSheet({
  open,
  onClose,
  currentName,
  title,
  label,
  submitLabel = "Rename",
  onSubmit
}: RenameSheetProps): ReactElement {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(currentName);
      queueMicrotask(() => inputRef.current?.select());
    }
  }, [open, currentName]);

  const trimmed = value.trim();
  // Create-mode (currentName === "") accepts any non-empty input; rename-mode
  // rejects an unchanged name so the submit is only active when the user
  // actually edits.
  const canSubmit = trimmed.length > 0 && trimmed !== currentName;

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={title} id="rename-sheet">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3 px-4 py-4"
      >
        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          {label}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="rename-input"
            className="rounded-md border border-line-strong bg-bg-raised px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
            autoFocus
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-dim hover:bg-bg-raised hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            data-testid="rename-submit"
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:bg-line-strong disabled:text-ink-mute"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}

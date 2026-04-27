import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { selectAttachedCount, useLayoutStore, type LayoutMode } from "../../stores/layout-store.js";

interface ModeOption {
  mode: LayoutMode;
  glyph: string;
  /** Key suffix into `layout.*` translations — e.g. `optionSingle`. */
  labelKey: "optionSingle" | "option1x2" | "option2x2";
}

const OPTIONS: ModeOption[] = [
  { mode: 1, glyph: "▢", labelKey: "optionSingle" },
  { mode: 2, glyph: "◫", labelKey: "option1x2" },
  { mode: 4, glyph: "⊞", labelKey: "option2x2" }
];

export function LayoutButton(): ReactElement {
  const { t } = useTranslation();
  const mode = useLayoutStore((s) => s.mode);
  const setMode = useLayoutStore((s) => s.setMode);
  const attachedCount = useLayoutStore(selectAttachedCount);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const currentGlyph = OPTIONS.find((o) => o.mode === mode)?.glyph ?? "▢";

  // ADR-0013 §5: don't allow shrinking past the connected count — that
  // would require an implicit detach which the user must do explicitly.
  const disabledFor = useMemo(
    () =>
      (target: LayoutMode): string | null => {
        if (target >= attachedCount) return null;
        return t("layout.disabledTooltip", { count: attachedCount });
      },
    [attachedCount, t]
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("layout.triggerLabel")}
        data-testid="topbar-layout"
        data-layout-mode={mode}
        className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-bg-elev"
      >
        <span className="mr-1">{currentGlyph}</span>
        {t("layout.triggerText")}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="topbar-layout-menu"
          className="absolute right-0 top-full z-[1150] mt-1 min-w-[180px] overflow-hidden rounded-md border border-line bg-bg-elev shadow-lg"
        >
          {OPTIONS.map((opt) => {
            const selected = opt.mode === mode;
            const disabledReason = disabledFor(opt.mode);
            const disabled = disabledReason !== null;
            const cls =
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm " +
              (disabled
                ? "cursor-not-allowed text-ink-mute"
                : selected
                  ? "bg-bg-raised text-ink"
                  : "text-ink hover:bg-bg-raised cursor-pointer");
            return (
              <button
                key={opt.mode}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                aria-disabled={disabled}
                disabled={disabled}
                title={disabled ? (disabledReason ?? undefined) : undefined}
                data-testid={`topbar-layout-opt-${opt.mode}`}
                data-disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setMode(opt.mode);
                  close();
                }}
                className={cls}
              >
                <span className="w-4 text-center">{opt.glyph}</span>
                <span className="flex-1">{t(`layout.${opt.labelKey}`)}</span>
                {selected && !disabled && (
                  <span aria-hidden className="text-accent">
                    ✓
                  </span>
                )}
                {disabled && (
                  <span
                    aria-hidden
                    className="text-[10px] text-ink-mute"
                    data-testid={`topbar-layout-opt-${opt.mode}-blocked`}
                  >
                    {t("layout.disabledHint")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

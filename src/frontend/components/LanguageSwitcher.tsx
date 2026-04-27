import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { canonicalizeLocale, getCurrentLocale, setAppLanguage } from "../i18n/index.js";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../i18n/resources.js";

export interface LanguageSwitcherProps {
  /**
   * Visual variant. `compact` is a 🌐 icon-only button for the TopBar;
   * `inline` is a labeled row for the sidebar footer.
   */
  variant?: "compact" | "inline";
  className?: string;
}

/**
 * ADR-0016 §4: dropdown language switcher. Shows each locale's native
 * name so a user who can't read the current language can still find their
 * own. Persists to localStorage via `setAppLanguage`; i18next's
 * `languageChanged` event triggers reactive re-render across the app.
 */
export function LanguageSwitcher({
  variant = "compact",
  className
}: LanguageSwitcherProps): ReactElement {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<SupportedLocale>(() =>
    canonicalizeLocale(getCurrentLocale())
  );
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, []);

  const pick = async (locale: SupportedLocale): Promise<void> => {
    setCurrent(locale);
    setOpen(false);
    await setAppLanguage(locale);
  };

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`} data-testid="language-switcher">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("language.switcher")}
        title={t("language.switcher")}
        onClick={() => setOpen((v) => !v)}
        className={
          variant === "compact"
            ? "flex h-8 items-center justify-center rounded-md border border-line px-2.5 text-sm text-ink hover:bg-bg-elev"
            : "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-ink hover:bg-bg-elev"
        }
        data-testid="language-switcher-trigger"
      >
        {variant === "compact" ? (
          <span aria-hidden="true">🌐</span>
        ) : (
          <>
            <span>{t("language.switcher")}</span>
            <span className="text-ink-mute">{t(`language.${current}`)}</span>
          </>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 min-w-[180px] overflow-hidden rounded-md border border-line bg-bg-elev shadow-lg"
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <button
              key={locale}
              type="button"
              role="menuitemradio"
              aria-checked={locale === current}
              onClick={() => void pick(locale)}
              data-locale={locale}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-bg-raised ${
                locale === current ? "bg-bg-raised text-accent" : "text-ink"
              }`}
            >
              <span>{t(`language.${locale}`)}</span>
              {locale === current && (
                <span aria-hidden="true" className="text-accent">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

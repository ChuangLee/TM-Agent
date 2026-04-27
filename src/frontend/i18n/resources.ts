import en from "./locales/en.json" with { type: "json" };
import zhHans from "./locales/zh-Hans.json" with { type: "json" };
import ja from "./locales/ja.json" with { type: "json" };
import ko from "./locales/ko.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import de from "./locales/de.json" with { type: "json" };

/**
 * ADR-0016 §3: all supported locales statically imported so Vite inlines
 * them into the main bundle. 7 × ~2 KB today → ~15 KB gzipped when the
 * bundles grow in PR5/PR6. Not enough to warrant lazy per-locale chunks.
 */
export const SUPPORTED_LOCALES = ["en", "zh-Hans", "ja", "ko", "fr", "es", "de"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

export const resources = {
  en: { translation: en },
  "zh-Hans": { translation: zhHans },
  ja: { translation: ja },
  ko: { translation: ko },
  fr: { translation: fr },
  es: { translation: es },
  de: { translation: de }
} as const;

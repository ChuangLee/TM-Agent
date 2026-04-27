import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LOCALE, resources, SUPPORTED_LOCALES, type SupportedLocale } from "./resources.js";

/**
 * ADR-0016: i18next bootstrap. Called once from main.tsx before React
 * mounts. Detection order: explicit localStorage choice → browser
 * `navigator.language` (with region→base fallback and zh-CN→zh-Hans
 * canonicalization) → `en`.
 */

const LANGUAGE_STORAGE_KEY = "tm-agent.lang";

const LANGUAGE_ALIASES: Record<string, SupportedLocale> = {
  "zh-CN": "zh-Hans",
  "zh-SG": "zh-Hans",
  "zh-HK": "zh-Hans",
  zh: "zh-Hans"
  // zh-TW / zh-Hant aren't in the explicit alias table — no Traditional
  // Chinese bundle in v1. They still resolve to zh-Hans via the base-split
  // fallback below (`zh-TW` → base `zh` → alias → `zh-Hans`), which is
  // closer to readable than defaulting to en.
};

export const canonicalizeLocale = (raw: string | null | undefined): SupportedLocale => {
  if (!raw) return DEFAULT_LOCALE;
  if ((SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
    return raw as SupportedLocale;
  }
  if (raw in LANGUAGE_ALIASES) {
    return LANGUAGE_ALIASES[raw]!;
  }
  const base = raw.split("-")[0]?.toLowerCase();
  if (base && (SUPPORTED_LOCALES as readonly string[]).includes(base)) {
    return base as SupportedLocale;
  }
  if (base && base in LANGUAGE_ALIASES) {
    return LANGUAGE_ALIASES[base]!;
  }
  return DEFAULT_LOCALE;
};

const readStoredLocale = (): SupportedLocale | undefined => {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (!stored) return undefined;
    return canonicalizeLocale(stored);
  } catch {
    return undefined;
  }
};

const detectInitialLocale = (): SupportedLocale => {
  const stored = readStoredLocale();
  if (stored) return stored;
  if (typeof navigator !== "undefined") {
    const candidates = [navigator.language, ...(navigator.languages ?? [])];
    for (const candidate of candidates) {
      const resolved = canonicalizeLocale(candidate);
      if (resolved !== DEFAULT_LOCALE || candidate?.toLowerCase().startsWith("en")) {
        return resolved;
      }
    }
  }
  return DEFAULT_LOCALE;
};

export const setAppLanguage = async (locale: SupportedLocale): Promise<void> => {
  await i18n.changeLanguage(locale);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    // localStorage unavailable (private mode, quota). The in-memory switch
    // stays, but won't persist past reload — acceptable degradation.
  }
};

export const getCurrentLocale = (): SupportedLocale => canonicalizeLocale(i18n.language);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: detectInitialLocale(),
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false // React escapes by default
    },
    detection: {
      // We already ran our own detector at init time; keep the built-in
      // detector off the `navigator` path so it doesn't fight our alias
      // table (zh-CN → zh-Hans).
      order: ["localStorage"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: []
    }
  });

// Keep `<html lang>` in sync with the active locale. Screen readers, form
// autofill, and the browser's built-in page translator all use this.
if (typeof document !== "undefined") {
  const applyLang = (lng: string): void => {
    document.documentElement.lang = canonicalizeLocale(lng);
  };
  applyLang(i18n.language);
  i18n.on("languageChanged", applyLang);
}

export default i18n;

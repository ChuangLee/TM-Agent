import { describe, expect, test } from "vitest";
import { canonicalizeLocale } from "../../../src/frontend/i18n/index.js";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../../../src/frontend/i18n/resources.js";

describe("canonicalizeLocale", () => {
  test("passes through directly-supported locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(canonicalizeLocale(locale)).toBe(locale);
    }
  });

  test("maps zh-CN / zh-HK / zh-SG / bare zh to zh-Hans", () => {
    expect(canonicalizeLocale("zh-CN")).toBe("zh-Hans");
    expect(canonicalizeLocale("zh-HK")).toBe("zh-Hans");
    expect(canonicalizeLocale("zh-SG")).toBe("zh-Hans");
    expect(canonicalizeLocale("zh")).toBe("zh-Hans");
  });

  test("zh-TW falls through to zh-Hans via the `zh` base alias", () => {
    // We ship no Traditional Chinese bundle in v1, but Simplified Chinese
    // is closer to readable for a zh-TW speaker than defaulting them to en.
    expect(canonicalizeLocale("zh-TW")).toBe("zh-Hans");
  });

  test("region-qualified base locales fall back to base", () => {
    expect(canonicalizeLocale("en-US")).toBe("en");
    expect(canonicalizeLocale("ja-JP")).toBe("ja");
    expect(canonicalizeLocale("fr-CA")).toBe("fr");
    expect(canonicalizeLocale("de-AT")).toBe("de");
  });

  test("unsupported locales fall back to the default", () => {
    expect(canonicalizeLocale("ru")).toBe(DEFAULT_LOCALE);
    expect(canonicalizeLocale("pt-BR")).toBe(DEFAULT_LOCALE);
    expect(canonicalizeLocale("xx-ZZ")).toBe(DEFAULT_LOCALE);
  });

  test("nullish / empty inputs fall back to the default", () => {
    expect(canonicalizeLocale(null)).toBe(DEFAULT_LOCALE);
    expect(canonicalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(canonicalizeLocale("")).toBe(DEFAULT_LOCALE);
  });
});

#!/usr/bin/env -S tsx
/**
 * ADR-0016 §8: locale key coverage report.
 *
 * Walks every key in `en.json` (the canonical source) and, for each other
 * locale, reports any missing keys or keys that fell back to the English
 * value verbatim (likely a missed translation). Does NOT exit non-zero —
 * translations lag behind feature extraction by design, and we don't want
 * to block CI or pre-commit on a new `common.save` key that hasn't been
 * hand-translated yet. Run it manually before cutting a release.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCALES_DIR = path.join(__dirname, "..", "src", "frontend", "i18n", "locales");

type LocaleTree = Record<string, unknown>;

const flatten = (obj: LocaleTree, prefix = ""): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      out[key] = v;
    } else if (v && typeof v === "object") {
      Object.assign(out, flatten(v as LocaleTree, key));
    }
  }
  return out;
};

const loadLocale = (name: string): Record<string, string> => {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${name}.json`), "utf8");
  return flatten(JSON.parse(raw) as LocaleTree);
};

const OTHER_LOCALES = ["zh-Hans", "ja", "ko", "fr", "es", "de"] as const;

const en = loadLocale("en");
const enKeys = new Set(Object.keys(en));

let totalMissing = 0;
let totalUntranslated = 0;

for (const locale of OTHER_LOCALES) {
  const other = loadLocale(locale);
  const otherKeys = new Set(Object.keys(other));

  const missing = [...enKeys].filter((k) => !otherKeys.has(k));
  // "Untranslated" heuristic: identical to the English string for keys that
  // are normally words, not brand tokens. Skip short ASCII-only values (OK,
  // ↵, 1×2, etc.) because those are legitimately locale-neutral.
  const untranslated = [...enKeys].filter((k) => {
    if (!otherKeys.has(k)) return false;
    const v = other[k];
    if (!v) return false;
    if (v !== en[k]) return false;
    if (/^[\s\x21-\x7E]{0,4}$/.test(v)) return false; // very short ASCII tokens
    if (/^[A-Z]{2,3}$/.test(v)) return false; // acronyms
    return true;
  });

  totalMissing += missing.length;
  totalUntranslated += untranslated.length;

  const header = `── ${locale} `;
  console.log(header.padEnd(50, "─"));
  console.log(
    `  missing:      ${missing.length} keys${missing.length ? " " + missing.slice(0, 5).join(", ") + (missing.length > 5 ? ` (+${missing.length - 5} more)` : "") : ""}`
  );
  console.log(
    `  untranslated: ${untranslated.length} keys${untranslated.length ? " " + untranslated.slice(0, 5).join(", ") + (untranslated.length > 5 ? ` (+${untranslated.length - 5} more)` : "") : ""}`
  );
}

console.log(
  `\nTotals: ${totalMissing} missing key(s), ${totalUntranslated} likely-untranslated key(s) across ${OTHER_LOCALES.length} locales.`
);
console.log(
  `Informational only — does not exit non-zero. Add to a release checklist manually if needed.`
);

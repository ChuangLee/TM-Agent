import "i18next";
import en from "./locales/en.json";

/**
 * ADR-0016 §7: TypeScript augmentation so `t("sessions.newSession")` gets
 * autocomplete + compile-time validation against the `en.json` key shape.
 * Missing keys in other locale files don't trip the compiler (runtime
 * fallback to en); `scripts/check-locales.ts` covers drift reporting.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof en;
    };
  }
}

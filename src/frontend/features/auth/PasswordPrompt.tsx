import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../stores/auth-store.js";

export function PasswordPrompt(): ReactElement {
  const { t } = useTranslation();
  const storedPassword = useAuthStore((s) => s.password);
  const errorMessage = useAuthStore((s) => s.errorMessage);
  const setPassword = useAuthStore((s) => s.setPassword);
  const setPhase = useAuthStore((s) => s.setPhase);
  const [draft, setDraft] = useState(storedPassword);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!draft) return;
    setPassword(draft);
    setPhase("authenticating");
  };

  return (
    <main className="flex h-full flex-col items-center justify-center px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-line bg-bg-elev p-6 shadow-2xl"
      >
        <h1 className="mb-1 text-xl font-semibold text-ink">{t("auth.title")}</h1>
        <p className="mb-4 text-sm text-ink-dim">{t("auth.passwordPrompt")}</p>
        <input
          ref={inputRef}
          type="password"
          autoComplete="current-password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("auth.passwordPlaceholder")}
          className="w-full rounded-lg border border-line-strong bg-bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-mute focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
        />
        {errorMessage && <p className="mt-2 text-xs text-err">{errorMessage}</p>}
        <button
          type="submit"
          disabled={!draft}
          className="mt-4 w-full rounded-lg bg-accent py-2 text-sm font-semibold text-bg hover:bg-[#93cdff] active:bg-[#5faae8] disabled:bg-line-strong disabled:text-ink-mute"
        >
          {t("auth.unlock")}
        </button>
      </form>
    </main>
  );
}

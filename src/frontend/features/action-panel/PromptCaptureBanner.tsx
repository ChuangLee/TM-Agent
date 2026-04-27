import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useShellStateStore } from "../../stores/shell-state-store.js";

export interface PromptCaptureBannerProps {
  /** For confirm_prompt: sends `y\r` or `n\r`. */
  onSend(bytes: string): void;
  /** For password_prompt: sends the secret + `\r` byte-by-byte. */
  onSendSecret(text: string): void;
  /** Password cancel → Ctrl+C to the PTY. */
  onCancel(): void;
}

/**
 * Rendered in the same grid slot as `<ActionPanel />`. When the classifier
 * reports `confirm_prompt` or `password_prompt`, this takes over; otherwise
 * it renders null. ActionPanel short-circuits on the same states so the two
 * are mutually exclusive.
 */
export function PromptCaptureBanner(props: PromptCaptureBannerProps): ReactElement | null {
  const shellState = useShellStateStore((s) => s.current);

  if (shellState.state === "confirm_prompt") {
    return <ConfirmBanner tail={shellState.tailSample} onSend={props.onSend} />;
  }
  if (shellState.state === "password_prompt") {
    return (
      <PasswordBanner
        tail={shellState.tailSample}
        onSendSecret={props.onSendSecret}
        onCancel={props.onCancel}
      />
    );
  }
  return null;
}

function detectConfirmDefault(tail: string): "yes" | "no" | "unknown" {
  if (/\[Y\/n\]/.test(tail)) return "yes";
  if (/\[y\/N\]/.test(tail)) return "no";
  // `(yes/no)` and `(y/n)` do not publish a default; pick yes as the
  // least-surprising fallback (most scripts take Enter-to-continue).
  return "unknown";
}

function ConfirmBanner({
  tail,
  onSend
}: {
  tail: string;
  onSend: (bytes: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const detected = detectConfirmDefault(tail);
  const match = tail.match(/(\[[yYnN]\/[yYnN]\]|\([yY]es\/[nN]o\)|\(y\/n\))/);
  const rawPrompt = match?.[0] ?? "";

  return (
    <div role="alert" aria-live="assertive" className="tm-prompt-banner tm-prompt-confirm">
      <div className="tm-prompt-title">
        {rawPrompt
          ? t("prompt.confirmWaitingWithRaw", { raw: rawPrompt })
          : t("prompt.confirmWaiting")}
      </div>
      <div className="tm-prompt-actions">
        <button
          type="button"
          data-default={detected === "yes" || detected === "unknown" ? "true" : "false"}
          className={
            detected === "yes" || detected === "unknown"
              ? "tm-prompt-btn tm-prompt-btn-primary"
              : "tm-prompt-btn"
          }
          onClick={() => onSend("y\r")}
        >
          {t("prompt.yes")}
        </button>
        <button
          type="button"
          data-default={detected === "no" ? "true" : "false"}
          className={detected === "no" ? "tm-prompt-btn tm-prompt-btn-primary" : "tm-prompt-btn"}
          onClick={() => onSend("n\r")}
        >
          {t("prompt.no")}
        </button>
      </div>
    </div>
  );
}

function PasswordBanner({
  tail,
  onSendSecret,
  onCancel
}: {
  tail: string;
  onSendSecret: (text: string) => void;
  onCancel: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = (): void => {
    onSendSecret(value + "\r");
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div role="alert" aria-live="assertive" className="tm-prompt-banner tm-prompt-password">
      <label className="tm-prompt-title" htmlFor="tm-prompt-password-input">
        {t("prompt.passwordLabel")}
        {tail ? <span className="tm-prompt-hint"> — {tail.trim()}</span> : null}
      </label>
      <div className="tm-prompt-actions">
        <input
          id="tm-prompt-password-input"
          ref={inputRef}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
          aria-label={t("prompt.passwordAria")}
          className="tm-prompt-input"
        />
        <button
          type="button"
          className="tm-prompt-btn tm-prompt-btn-ghost"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? t("prompt.hide") : t("prompt.show")}
        </button>
        <button
          type="button"
          className="tm-prompt-btn tm-prompt-btn-ghost"
          onClick={() => {
            setValue("");
            onCancel();
          }}
        >
          {t("prompt.cancel")}
        </button>
        <button type="button" className="tm-prompt-btn tm-prompt-btn-primary" onClick={send}>
          {t("prompt.send")}
        </button>
      </div>
    </div>
  );
}

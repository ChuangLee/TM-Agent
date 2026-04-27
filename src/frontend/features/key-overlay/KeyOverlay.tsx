import { useCallback, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useShellStateStore } from "../../stores/shell-state-store.js";
import { applyModifiers, contextualKeys, fnKeyPayload, type OverlayKey } from "./key-layout.js";
import { useStickyModifiers, type ModifierKey, type ModifierState } from "./use-sticky-modifier.js";

const LONG_PRESS_MS = 500;

export interface KeyOverlayProps {
  open: boolean;
  onClose(): void;
  onSend(bytes: string): void;
  onOpenCompose(): void;
}

const HIGH_FREQ_KEYS: OverlayKey[] = [
  { label: "Esc", payload: "\x1b" },
  { label: "Tab", payload: "\t" },
  { label: "Enter", payload: "\r" },
  { label: "⌫", payload: "\x7f" }
];

const SYMBOLS: OverlayKey[] = [
  { label: "|", payload: "|" },
  { label: "~", payload: "~" },
  { label: "/", payload: "/" },
  { label: "\\", payload: "\\" }
];

const LETTER_KEYS = "abcdefghijklmnopqrstuvwxyz0123456789".split("");

export function KeyOverlay(props: KeyOverlayProps): ReactElement | null {
  const { open, onClose, onSend, onOpenCompose } = props;
  const { t } = useTranslation();
  const shellState = useShellStateStore((s) => s.current);
  const modifiers = useStickyModifiers();
  const [fnOpen, setFnOpen] = useState(false);

  const sendKey = useCallback(
    (payload: string): void => {
      const active = modifiers.consume();
      onSend(applyModifiers(active, payload));
    },
    [modifiers, onSend]
  );

  if (!open) return null;

  return (
    <div
      className="tm-key-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("keyOverlay.label")}
    >
      <div className="tm-key-overlay-handle" aria-hidden="true" onClick={onClose} />

      <ContextualBand
        state={shellState.state}
        cmd={shellState.paneCurrentCommand}
        onSend={sendKey}
      />

      <div className="tm-key-overlay-zone-title">{t("keyOverlay.zoneModifiers")}</div>
      <div className="tm-key-overlay-modifiers">
        {(["ctrl", "alt", "shift", "meta"] as ModifierKey[]).map((k) => (
          <ModifierButton
            key={k}
            modKey={k}
            state={modifiers.state[k]}
            onTap={modifiers.tap}
            onLongPress={modifiers.longPress}
          />
        ))}
      </div>

      <div className="tm-key-overlay-zone-title">{t("keyOverlay.zoneArrows")}</div>
      <div className="tm-key-overlay-arrows">
        <button className="tm-overlay-key tm-overlay-arrow-up" onClick={() => sendKey("\x1b[A")}>
          ↑
        </button>
        <button className="tm-overlay-key tm-overlay-arrow-left" onClick={() => sendKey("\x1b[D")}>
          ←
        </button>
        <button className="tm-overlay-key tm-overlay-arrow-down" onClick={() => sendKey("\x1b[B")}>
          ↓
        </button>
        <button className="tm-overlay-key tm-overlay-arrow-right" onClick={() => sendKey("\x1b[C")}>
          →
        </button>
      </div>

      <div className="tm-key-overlay-zone-title">{t("keyOverlay.zoneHighFreq")}</div>
      <div className="tm-key-overlay-row">
        {HIGH_FREQ_KEYS.map((k) => (
          <button
            key={k.label}
            className="tm-overlay-key tm-overlay-key-big"
            onClick={() => sendKey(k.payload)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="tm-key-overlay-row">
        {SYMBOLS.map((k) => (
          <button key={k.label} className="tm-overlay-key" onClick={() => sendKey(k.payload)}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="tm-key-overlay-row tm-key-overlay-letters" aria-hidden={!fnOpen && undefined}>
        {/* a–z + 0–9 appear only when a modifier is armed/locked; otherwise
            the user types via compose bar. Rendering them always would
            clutter the overlay; but for the Ctrl+<letter> flow we need
            these live. Keep them mounted but CSS-hidden unless any
            modifier is active OR `Fn` area is open (so they're reachable
            via the letter grid when modifier+letter combos are needed). */}
        {LETTER_KEYS.map((ch) => (
          <button
            key={ch}
            className="tm-overlay-key tm-overlay-key-letter"
            onClick={() => sendKey(ch)}
          >
            {ch}
          </button>
        ))}
      </div>

      {fnOpen && (
        <div className="tm-key-overlay-fn">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              className="tm-overlay-key tm-overlay-key-fn"
              onClick={() => sendKey(fnKeyPayload(n))}
            >
              {`F${n}`}
            </button>
          ))}
        </div>
      )}

      <div className="tm-key-overlay-footer">
        <button
          className="tm-overlay-key tm-overlay-fn-toggle"
          onClick={() => setFnOpen((v) => !v)}
        >
          Fn
        </button>
        <button
          className="tm-overlay-key tm-overlay-compose-link"
          onClick={() => {
            onOpenCompose();
            onClose();
          }}
          aria-label={t("keyOverlay.composeLinkAria")}
        >
          {t("keyOverlay.composeLink")}
        </button>
      </div>
    </div>
  );
}

function ContextualBand({
  state,
  cmd,
  onSend
}: {
  state: ReturnType<typeof useShellStateStore.getState>["current"]["state"];
  cmd: string;
  onSend(payload: string): void;
}): ReactElement | null {
  const { t } = useTranslation();
  const keys = contextualKeys(state, cmd);
  if (keys.length === 0) return null;
  return (
    <>
      <div className="tm-key-overlay-zone-title">{t("keyOverlay.zoneState", { state })}</div>
      <div className="tm-key-overlay-row">
        {keys.map((k) => (
          <button key={k.label} className="tm-overlay-key" onClick={() => onSend(k.payload)}>
            {k.label}
          </button>
        ))}
      </div>
    </>
  );
}

function ModifierButton({
  modKey,
  state,
  onTap,
  onLongPress
}: {
  modKey: ModifierKey;
  state: ModifierState;
  onTap(k: ModifierKey): void;
  onLongPress(k: ModifierKey): void;
}): ReactElement {
  const longPressFiredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <button
      className="tm-overlay-key tm-overlay-mod"
      data-mod={modKey}
      data-mod-state={state}
      onPointerDown={() => {
        longPressFiredRef.current = false;
        clear();
        timerRef.current = setTimeout(() => {
          longPressFiredRef.current = true;
          onLongPress(modKey);
        }, LONG_PRESS_MS);
      }}
      onPointerUp={() => {
        clear();
        if (!longPressFiredRef.current) onTap(modKey);
      }}
      onPointerCancel={clear}
      onPointerLeave={clear}
    >
      {label(modKey)}
    </button>
  );
}

function label(k: ModifierKey): string {
  if (k === "ctrl") return "Ctrl";
  if (k === "alt") return "Alt";
  if (k === "shift") return "Shift";
  return "⌘";
}

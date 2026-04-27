import { useEffect, useRef, useState, type CompositionEvent, type ReactElement } from "react";

export interface ImeBridgeProps {
  active: boolean;
  onCompositionDone(text: string): void;
}

/**
 * Hidden <textarea> that captures IME composition events in Direct Mode.
 * While composing, the intermediate value shows in a small floater near the
 * visible cursor (v1 pins to top-right — locating the terminal cursor in
 * screen coords is a Phase 6 polish).
 */
export function ImeBridge({ active, onCompositionDone }: ImeBridgeProps): ReactElement | null {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [composing, setComposing] = useState(false);
  const [buffer, setBuffer] = useState("");

  useEffect(() => {
    if (!active) return;
    textareaRef.current?.focus();
    const refocus = (): void => {
      if (active) textareaRef.current?.focus();
    };
    document.addEventListener("click", refocus);
    return () => document.removeEventListener("click", refocus);
  }, [active]);

  if (!active) return null;

  const onCompositionStart = (): void => {
    setComposing(true);
    setBuffer("");
  };
  const onCompositionUpdate = (e: CompositionEvent<HTMLTextAreaElement>): void => {
    setBuffer(e.data ?? "");
  };
  const onCompositionEnd = (e: CompositionEvent<HTMLTextAreaElement>): void => {
    setComposing(false);
    setBuffer("");
    const data = e.data ?? "";
    if (data) onCompositionDone(data);
    if (textareaRef.current) textareaRef.current.value = "";
  };

  return (
    <>
      <textarea
        ref={textareaRef}
        aria-hidden="true"
        tabIndex={-1}
        onCompositionStart={onCompositionStart}
        onCompositionUpdate={onCompositionUpdate}
        onCompositionEnd={onCompositionEnd}
        className="tm-direct-mode-ime-sink"
        autoComplete="off"
        spellCheck={false}
      />
      {composing && buffer && (
        <div className="tm-direct-mode-ime-floater" role="status" aria-live="polite">
          {buffer}
        </div>
      )}
    </>
  );
}

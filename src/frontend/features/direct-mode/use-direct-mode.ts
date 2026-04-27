import { useCallback, useEffect, useRef, useState } from "react";
import { keydownToBytes } from "./keydown-to-bytes.js";

export type DirectModeStatus = "idle" | "entering" | "active" | "exiting";
export type DirectModeExitSource = "button" | "ctrl-bracket" | "shift-esc" | "indicator";

const TRANSITION_MS = 200;

export interface UseDirectModeArgs {
  onSendBytes(bytes: string): void;
}

export interface UseDirectModeResult {
  available: boolean;
  status: DirectModeStatus;
  active: boolean;
  enter(): void;
  exit(source: DirectModeExitSource): void;
  toggle(): void;
}

const BROWSER_COPY_GRACE_MS = 1000;

function detectAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const wide = window.matchMedia("(min-width: 820px)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (wide && fine) return true;
    // URL param escape hatch: ?direct_mode=1 forces availability on any device.
    const q = new URLSearchParams(window.location.search).get("direct_mode");
    return q === "1";
  } catch {
    return false;
  }
}

/**
 * Direct Mode — on desktop, captures document-level keydown and streams
 * bytes directly to the PTY. Visual blur + indicator treatment is applied
 * via a `data-direct-mode` attribute on `<body>`; consumers style on that.
 */
export function useDirectMode(args: UseDirectModeArgs): UseDirectModeResult {
  const { onSendBytes } = args;
  const [status, setStatus] = useState<DirectModeStatus>("idle");
  const statusRef = useRef<DirectModeStatus>("idle");
  const onSendRef = useRef(onSendBytes);
  const browserCopyKeydownAtRef = useRef(0);
  onSendRef.current = onSendBytes;
  statusRef.current = status;

  const available = detectAvailable();

  const enter = useCallback((): void => {
    if (statusRef.current !== "idle") return;
    statusRef.current = "entering";
    setStatus("entering");
    setTimeout(() => {
      if (statusRef.current !== "entering") return;
      statusRef.current = "active";
      setStatus("active");
    }, TRANSITION_MS);
  }, []);

  const exit = useCallback((_source: DirectModeExitSource): void => {
    const cur = statusRef.current;
    if (cur !== "active" && cur !== "entering") return;
    statusRef.current = "exiting";
    setStatus("exiting");
    setTimeout(() => {
      if (statusRef.current !== "exiting") return;
      statusRef.current = "idle";
      setStatus("idle");
    }, TRANSITION_MS);
  }, []);

  const toggle = useCallback((): void => {
    const cur = statusRef.current;
    if (cur === "idle" || cur === "exiting") enter();
    else exit("button");
  }, [enter, exit]);

  // Auto-enter on cold start if the URL declares intent (?direct_mode=1).
  const enteredFromUrlRef = useRef(false);
  useEffect(() => {
    if (enteredFromUrlRef.current) return;
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("direct_mode");
    if (q === "1" && statusRef.current === "idle") {
      enteredFromUrlRef.current = true;
      enter();
    }
  }, [enter]);

  // Reflect onto <body data-direct-mode="..."> so CSS can target.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (status === "idle") {
      document.body.removeAttribute("data-direct-mode");
    } else {
      document.body.setAttribute("data-direct-mode", status);
    }
  }, [status]);

  // Global keydown capture while active (or entering, so mid-animation
  // presses aren't dropped).
  useEffect(() => {
    if (status !== "active" && status !== "entering") return;

    const handler = (e: KeyboardEvent): void => {
      const key = (e.key ?? "").toLowerCase();
      if (
        key === "c" &&
        ((e.metaKey && !e.ctrlKey && !e.altKey) ||
          (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey))
      ) {
        browserCopyKeydownAtRef.current = Date.now();
      }

      // Ctrl+] is the exit signal.
      if (e.ctrlKey && !e.altKey && !e.metaKey && (e.code === "BracketRight" || e.key === "]")) {
        e.preventDefault();
        e.stopPropagation();
        exit("ctrl-bracket");
        return;
      }
      // Shift+Esc → exit. Plain Esc still forwards as \x1b so vim / Claude
      // Code behave normally; double-Esc used to trigger exit but collided
      // with Claude Code's "Esc Esc to edit queue" gesture.
      if (e.key === "Escape" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        exit("shift-esc");
        return;
      }

      const bytes = keydownToBytes(e);
      if (bytes === null) return;
      e.preventDefault();
      e.stopPropagation();
      onSendRef.current(bytes);
    };

    document.addEventListener("keydown", handler, { capture: true });
    return () => {
      document.removeEventListener("keydown", handler, { capture: true });
    };
  }, [status, exit]);

  // Windows Chromium can route Ctrl+C through the browser's native `copy`
  // command when focus is sitting in editable chrome. If our keydown handler
  // did not get a chance to translate it, a copy event with no text selection
  // is the best remaining signal for terminal SIGINT. Explicit browser-copy
  // chords (Cmd+C / Ctrl+Shift+C) and real text selections keep native copy.
  useEffect(() => {
    if (status !== "active" && status !== "entering") return;

    const handler = (e: ClipboardEvent): void => {
      const selection = document.getSelection();
      const hasSelection = Boolean(selection && !selection.isCollapsed && selection.toString());
      const recentBrowserCopy =
        Date.now() - browserCopyKeydownAtRef.current < BROWSER_COPY_GRACE_MS;
      if (hasSelection || recentBrowserCopy) return;
      e.preventDefault();
      e.stopPropagation();
      onSendRef.current("\x03");
    };

    document.addEventListener("copy", handler, { capture: true });
    return () => {
      document.removeEventListener("copy", handler, { capture: true });
    };
  }, [status]);

  // Paste forwarding: Cmd+V / Ctrl+Shift+V fall through keydownToBytes, so
  // the browser fires a native `paste` event on document. Intercept,
  // normalize line endings to CR (terminals prefer CR, not LF), and send
  // the bytes to the PTY.
  useEffect(() => {
    if (status !== "active" && status !== "entering") return;

    const handler = (e: ClipboardEvent): void => {
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      const normalized = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
      onSendRef.current(normalized);
    };

    document.addEventListener("paste", handler, { capture: true });
    return () => {
      document.removeEventListener("paste", handler, { capture: true });
    };
  }, [status]);

  return {
    available,
    status,
    active: status === "active",
    enter,
    exit,
    toggle
  };
}

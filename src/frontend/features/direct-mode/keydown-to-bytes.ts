/**
 * Map a KeyboardEvent to the bytes that xterm / readline / vim would have
 * received on a real terminal. Return `null` to skip forwarding (browser
 * reserved key, IME composition, etc.).
 */
export function keydownToBytes(e: KeyboardEvent): string | null {
  // IME composition — the ImeBridge handles the composed string separately.
  if (e.isComposing || e.keyCode === 229) return null;

  // Browser-reserved combos (the browser usually eats these before us,
  // but some fire and we must not fight the UA).
  const k = e.key ?? "";
  const lk = k.toLowerCase();
  if (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    !e.altKey &&
    ["t", "w", "r", "n", "q"].includes(lk)
  ) {
    return null;
  }
  // Copy / paste / cut: defer to the browser. Selection-based copy works
  // against the `.tm-rows` DOM naturally; paste lands on a document-level
  // `paste` listener registered by useDirectMode that forwards bytes to the
  // PTY. Mac: Cmd+C/V/X. Linux/Windows terminal convention: Ctrl+Shift+C/V/X
  // (bare Ctrl+C must stay reserved for SIGINT).
  if (["c", "v", "x"].includes(lk)) {
    if (e.metaKey && !e.ctrlKey && !e.altKey) return null;
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) return null;
  }

  switch (k) {
    case "Enter":
      return "\r";
    case "Tab":
      return "\t";
    case "Backspace":
      return "\x7f";
    case "Delete":
      return "\x1b[3~";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowLeft":
      return "\x1b[D";
    case "ArrowRight":
      return "\x1b[C";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
  }

  // F1..F12
  if (/^F([1-9]|1[0-2])$/.test(k)) {
    const n = parseInt(k.slice(1), 10);
    if (n <= 4) return "\x1bO" + "PQRS"[n - 1];
    const csi = [15, 17, 18, 19, 20, 21, 23, 24]; // F5..F12
    return "\x1b[" + csi[n - 5] + "~";
  }

  if (k.length === 1) {
    // Ctrl+<letter> → control char
    if (e.ctrlKey && !e.altKey && !e.metaKey && /^[a-zA-Z]$/.test(k)) {
      return String.fromCharCode(k.toLowerCase().charCodeAt(0) - 96);
    }
    // Alt+<char> → ESC prefix (Meta encoding / Emacs style)
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      return "\x1b" + k;
    }
    return k;
  }

  return null;
}

/**
 * Gated debug logger. Off by default; enable with one of:
 *   - URL param:      ?debug=1 (or ?debug=terminal,ws)
 *   - localStorage:   tm-agent_debug = "1" / "terminal,ws"
 *   - window flag:    window.__tmuxDebug = true
 *
 * Scopes let you log selectively (e.g., ?debug=terminal silences ws noise).
 * Unknown scopes pass through when `?debug=1` is used (match-all).
 *
 * Output format: `[tm-agent:<scope>] <label>` + key/value object, with a
 * monotonic `t` (ms since page load) so you can correlate with user
 * observations. Also exposes `window.__tmuxDebugDump()` that returns the
 * rolling buffer — handy when the user says "it just flickered" and you
 * want the last 200 events.
 */

const BUFFER_SIZE = 200;

interface DebugRecord {
  t: number;
  scope: string;
  label: string;
  data?: Record<string, unknown>;
}

let enabledScopes: Set<string> | "all" | null = null;
const buffer: DebugRecord[] = [];
const start = typeof performance !== "undefined" ? performance.now() : 0;

function resolveEnabled(): Set<string> | "all" | null {
  if (typeof window === "undefined") return null;
  try {
    const w = window as unknown as { __tmuxDebug?: boolean | string };
    if (w.__tmuxDebug === true) return "all";
    if (typeof w.__tmuxDebug === "string" && w.__tmuxDebug.length > 0) {
      return w.__tmuxDebug === "1" ? "all" : new Set(w.__tmuxDebug.split(","));
    }
    const urlParam = new URLSearchParams(window.location.search).get("debug");
    if (urlParam != null && urlParam !== "0") {
      return urlParam === "1" ? "all" : new Set(urlParam.split(","));
    }
    const ls = window.localStorage?.getItem("tm-agent_debug");
    if (ls && ls !== "0") {
      return ls === "1" ? "all" : new Set(ls.split(","));
    }
  } catch {
    /* no-op */
  }
  return null;
}

function isEnabled(scope: string): boolean {
  if (enabledScopes === null) enabledScopes = resolveEnabled();
  if (enabledScopes === null) return false;
  if (enabledScopes === "all") return true;
  return enabledScopes.has(scope);
}

export function debugLog(scope: string, label: string, data?: Record<string, unknown>): void {
  const record: DebugRecord = {
    t: Math.round(typeof performance !== "undefined" ? performance.now() - start : 0),
    scope,
    label,
    data
  };
  buffer.push(record);
  if (buffer.length > BUFFER_SIZE) buffer.shift();
  if (!isEnabled(scope)) return;
  if (data) {
    console.info(`[tm-agent:${scope}] ${label}`, data);
  } else {
    console.info(`[tm-agent:${scope}] ${label}`);
  }
}

// Attach a dump helper to window so users can retrieve buffered events
// even when scoped logging was off. Always collects; only prints gated.
if (typeof window !== "undefined") {
  (window as unknown as { __tmuxDebugDump?: () => DebugRecord[] }).__tmuxDebugDump = () =>
    buffer.slice();
}

/**
 * Format a unix-seconds timestamp as a compact relative time string:
 *   42s   · up to 60 seconds
 *   17m   · up to 60 minutes
 *   3h    · up to 24 hours
 *   2d    · up to 7 days
 *   4w    · up to ~30 days
 *   -     · past that we render nothing (the session has been idle long
 *           enough that the user probably doesn't need a stale count)
 *
 * ADR-0016 considered making this `Intl.RelativeTimeFormat`-aware, but even
 * the `narrow` style renders English as `"15s ago"` — ~2x the width of this
 * compact form and long enough to break the SessionList row layout. These
 * single-letter unit suffixes are tech-universal (bytes, network dashboards,
 * GitHub CI all use the same convention), so we keep one glyph regardless
 * of locale. Revisit if a real user complaint shows up.
 *
 * Rounding is floor'd — "just now" surfaces as "0s" rather than rounding up
 * to the next bucket, which matched how tmux itself reports `session_activity`.
 */
export function formatRelativeTime(
  activityUnixSeconds: number | undefined,
  nowUnixSeconds: number = Math.floor(Date.now() / 1000)
): string {
  if (activityUnixSeconds === undefined || !Number.isFinite(activityUnixSeconds)) {
    return "";
  }
  const delta = Math.max(0, nowUnixSeconds - activityUnixSeconds);
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h`;
  if (delta < 604_800) return `${Math.floor(delta / 86_400)}d`;
  if (delta < 2_592_000) return `${Math.floor(delta / 604_800)}w`;
  return "";
}

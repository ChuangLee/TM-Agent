export type SysinfoLevel = "ok" | "warn" | "hot";

/** 0..1 usage → level. Applies to CPU and memory. */
export const usageLevel = (fraction: number): SysinfoLevel => {
  if (fraction >= 0.85) return "hot";
  if (fraction >= 0.6) return "warn";
  return "ok";
};

/** Normalize 1-minute load by core count, then reuse the usage thresholds. */
export const loadLevel = (load1: number, cores: number): SysinfoLevel => {
  if (cores <= 0) return "ok";
  return usageLevel(load1 / cores);
};

export const LEVEL_CLASS: Record<SysinfoLevel, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  hot: "text-red-400"
};

export const LEVEL_DOT_BG: Record<SysinfoLevel, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  hot: "bg-red-500"
};

export const formatUptime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

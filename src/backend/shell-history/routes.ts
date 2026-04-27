import { Router, type RequestHandler } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AuthService } from "../auth/auth-service.js";
import { buildHttpAuthMiddleware } from "../files/http-auth.js";

export interface BuildShellHistoryRouterOptions {
  authService: AuthService;
  /**
   * Optional logger. Accepts any shape with at least `error` (the shape
   * server.ts hands us today) — warn is routed through `error` as a fallback
   * so we don't silently swallow parse failures when the caller uses a
   * stricter logger type.
   */
  logger?: Pick<Console, "error"> & { warn?: Console["warn"] };
}

export interface ShellHistoryEntry {
  cmd: string;
  /** Composite frecency score — higher = more prominent in the UI. */
  score: number;
}

// Resolve home at call time, not module load: tests redirect $HOME via
// process.env so the loader must follow. `os.homedir()` on Linux pulls
// from getpwuid_r and ignores $HOME, so we prefer $HOME when set.
const resolveHome = (): string => process.env.HOME || os.homedir();
const MAX_LINES_PER_FILE = 5000;
const MAX_RESPONSE_ENTRIES = 400;
// Obvious noise we don't want crowding out real candidates.
const SKIP_PATTERNS: RegExp[] = [
  /^\s*#/,
  /^\s*:\s+\d+:/, // zsh extended_history leaks if file is raw, but we strip metadata below
  /^\s*$/
];

const readFileSafe = async (p: string): Promise<string | null> => {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
};

/** Strip zsh extended_history metadata (": 1700000000:0;cmd") down to cmd. */
const normalizeLine = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const extendedMatch = /^:\s+\d+:\d+;(.*)$/.exec(trimmed);
  if (extendedMatch) return extendedMatch[1].trim();
  return trimmed;
};

const shouldSkip = (line: string): boolean => {
  if (!line) return true;
  if (line.length < 2) return true;
  if (line.length > 500) return true;
  for (const re of SKIP_PATTERNS) if (re.test(line)) return true;
  return false;
};

const collectFromFile = async (
  p: string,
  freq: Map<string, number>,
  recency: Map<string, number>
): Promise<void> => {
  const text = await readFileSafe(p);
  if (text === null) return;
  const lines = text.split("\n");
  // Keep only the tail — shells rotate these files but recent lines dominate.
  const startAt = Math.max(0, lines.length - MAX_LINES_PER_FILE);
  for (let i = startAt; i < lines.length; i++) {
    const cmd = normalizeLine(lines[i]);
    if (shouldSkip(cmd)) continue;
    freq.set(cmd, (freq.get(cmd) ?? 0) + 1);
    // Later index = more recent; keep the max.
    recency.set(cmd, Math.max(recency.get(cmd) ?? 0, i));
  }
};

const scoreEntries = (
  freq: Map<string, number>,
  recency: Map<string, number>
): ShellHistoryEntry[] => {
  const maxRecency = Math.max(1, ...recency.values());
  const out: ShellHistoryEntry[] = [];
  for (const [cmd, count] of freq) {
    const r = (recency.get(cmd) ?? 0) / maxRecency; // 0..1
    // Frecency: count carries weight, but recency wins ties. Tuned by feel —
    // the actual ordering matters less than "pinning top ~40 to the popover".
    const score = count * 1.0 + r * 5.0;
    out.push({ cmd, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, MAX_RESPONSE_ENTRIES);
};

const loadHistory = async (): Promise<ShellHistoryEntry[]> => {
  const freq = new Map<string, number>();
  const recency = new Map<string, number>();
  const home = resolveHome();
  const candidates = [
    process.env.HISTFILE,
    path.join(home, ".bash_history"),
    path.join(home, ".zsh_history"),
    path.join(home, ".local", "share", "fish", "fish_history")
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  await Promise.all(candidates.map((p) => collectFromFile(p, freq, recency)));
  return scoreEntries(freq, recency);
};

// Cache window — the shells append on exit, so sampling once per minute is
// plenty and keeps the endpoint cheap under reconnect storms. Cache is
// per-router-instance (not module-global) so tests can build a fresh router
// with a scratch $HOME without bleeding state from prior runs.
const CACHE_MS = 60_000;

const wrap = (handler: RequestHandler): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

export const buildShellHistoryRouter = (opts: BuildShellHistoryRouterOptions): Router => {
  const router = Router();
  router.use(buildHttpAuthMiddleware(opts.authService));

  let cached: { at: number; entries: ShellHistoryEntry[] } | null = null;

  router.get(
    "/",
    wrap(async (_req, res) => {
      const now = Date.now();
      if (!cached || now - cached.at > CACHE_MS) {
        try {
          const entries = await loadHistory();
          cached = { at: now, entries };
        } catch (err) {
          const log = opts.logger?.warn ?? opts.logger?.error;
          log?.("[shell-history] load failed", err);
          cached = { at: now, entries: [] };
        }
      }
      res.json({ entries: cached.entries });
    })
  );

  return router;
};

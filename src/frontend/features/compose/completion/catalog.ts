import type { ShellState } from "../../shell-state/state-definitions.js";
import type { Bucket, Entry, Trigger } from "./types.js";

export const MAX_ENTRIES = 6;

// Common built-in commands for Claude Code. Source:
// https://code.claude.com/docs/en/commands (fetched 2026-04-22). The full
// reference is ~80 entries; we keep the frequently-used subset so typing `/`
// gives a tight starter list and prefix-filtering narrows fast.
const CLAUDE_CODE_ENTRIES: Entry[] = [
  { label: "help", insert: "/help", hint: "Show help" },
  { label: "clear", insert: "/clear", hint: "Start a new conversation" },
  { label: "compact", insert: "/compact", hint: "Summarize to free context" },
  { label: "resume", insert: "/resume", hint: "Resume a conversation" },
  { label: "model", insert: "/model", hint: "Select or change model" },
  { label: "context", insert: "/context", hint: "Visualize context usage" },
  { label: "cost", insert: "/cost", hint: "Show token usage" },
  { label: "usage", insert: "/usage", hint: "Plan usage limits" },
  { label: "status", insert: "/status", hint: "Version, model, account" },
  { label: "config", insert: "/config", hint: "Settings" },
  { label: "exit", insert: "/exit", hint: "Exit the CLI" },
  { label: "diff", insert: "/diff", hint: "Interactive diff viewer" },
  { label: "plan", insert: "/plan", hint: "Enter plan mode" },
  { label: "memory", insert: "/memory", hint: "Edit CLAUDE.md" },
  { label: "review", insert: "/review", hint: "Review a pull request" },
  { label: "rewind", insert: "/rewind", hint: "Rewind the conversation" },
  { label: "branch", insert: "/branch", hint: "Branch this conversation" },
  { label: "copy", insert: "/copy", hint: "Copy last response" },
  { label: "export", insert: "/export", hint: "Export conversation" },
  { label: "agents", insert: "/agents", hint: "Manage agents" },
  { label: "skills", insert: "/skills", hint: "List skills" },
  { label: "mcp", insert: "/mcp", hint: "MCP connections" },
  { label: "hooks", insert: "/hooks", hint: "View hook configs" },
  { label: "permissions", insert: "/permissions", hint: "Allow/ask/deny rules" },
  { label: "init", insert: "/init", hint: "Initialize CLAUDE.md" },
  { label: "doctor", insert: "/doctor", hint: "Diagnose installation" },
  { label: "theme", insert: "/theme", hint: "Change color theme" },
  { label: "simplify", insert: "/simplify", hint: "Review & simplify code" },
  { label: "debug", insert: "/debug", hint: "Enable debug logging" },
  { label: "loop", insert: "/loop", hint: "Run a prompt on a loop" },
  { label: "batch", insert: "/batch", hint: "Parallelize large changes" },
  { label: "security-review", insert: "/security-review", hint: "Scan for vulns" },
  { label: "login", insert: "/login", hint: "Sign in" },
  { label: "logout", insert: "/logout", hint: "Sign out" }
];

// Common commands for Codex CLI interactive mode. Source:
// https://developers.openai.com/codex/cli/slash-commands (fetched 2026-04-22).
const CODEX_ENTRIES: Entry[] = [
  { label: "clear", insert: "/clear", hint: "Reset terminal, fresh chat" },
  { label: "compact", insert: "/compact", hint: "Summarize to save tokens" },
  { label: "new", insert: "/new", hint: "Start fresh conversation" },
  { label: "resume", insert: "/resume", hint: "Continue previous session" },
  { label: "fork", insert: "/fork", hint: "Branch current conversation" },
  { label: "model", insert: "/model", hint: "Select model & effort" },
  { label: "fast", insert: "/fast", hint: "Toggle Fast mode" },
  { label: "plan", insert: "/plan", hint: "Enter plan mode" },
  { label: "review", insert: "/review", hint: "Analyze working tree" },
  { label: "diff", insert: "/diff", hint: "Show git changes" },
  { label: "copy", insert: "/copy", hint: "Copy latest response" },
  { label: "mention", insert: "/mention", hint: "Attach files" },
  { label: "status", insert: "/status", hint: "Session config & usage" },
  { label: "permissions", insert: "/permissions", hint: "Adjust approvals" },
  { label: "agent", insert: "/agent", hint: "Switch agent thread" },
  { label: "apps", insert: "/apps", hint: "Browse connectors" },
  { label: "plugins", insert: "/plugins", hint: "Manage plugins" },
  { label: "mcp", insert: "/mcp", hint: "Configured MCP tools" },
  { label: "init", insert: "/init", hint: "Generate AGENTS.md" },
  { label: "ps", insert: "/ps", hint: "Background terminals" },
  { label: "stop", insert: "/stop", hint: "Cancel background work" },
  { label: "personality", insert: "/personality", hint: "Communication style" },
  { label: "experimental", insert: "/experimental", hint: "Optional features" },
  { label: "feedback", insert: "/feedback", hint: "Submit diagnostics" },
  { label: "logout", insert: "/logout", hint: "Clear credentials" },
  { label: "exit", insert: "/exit", hint: "Leave the session" }
];

// Common commands for Gemini CLI. Source:
// https://google-gemini.github.io/gemini-cli/docs/cli/commands.html (fetched
// 2026-04-22).
const GEMINI_ENTRIES: Entry[] = [
  { label: "help", insert: "/help", hint: "Display help" },
  { label: "clear", insert: "/clear", hint: "Clear terminal + history" },
  { label: "compress", insert: "/compress", hint: "Replace context with summary" },
  { label: "copy", insert: "/copy", hint: "Copy last output" },
  { label: "chat", insert: "/chat", hint: "Manage chat checkpoints" },
  { label: "memory", insert: "/memory", hint: "Manage GEMINI.md context" },
  { label: "init", insert: "/init", hint: "Generate GEMINI.md" },
  { label: "tools", insert: "/tools", hint: "List available tools" },
  { label: "extensions", insert: "/extensions", hint: "List active extensions" },
  { label: "mcp", insert: "/mcp", hint: "MCP servers" },
  { label: "settings", insert: "/settings", hint: "Edit settings" },
  { label: "editor", insert: "/editor", hint: "Select editor" },
  { label: "theme", insert: "/theme", hint: "Change visual theme" },
  { label: "auth", insert: "/auth", hint: "Switch auth method" },
  { label: "directory", insert: "/directory", hint: "Manage workspace dirs" },
  { label: "stats", insert: "/stats", hint: "Session statistics" },
  { label: "restore", insert: "/restore", hint: "Restore pre-tool state" },
  { label: "vim", insert: "/vim", hint: "Toggle vim mode" },
  { label: "about", insert: "/about", hint: "Version info" },
  { label: "bug", insert: "/bug", hint: "File an issue" },
  { label: "privacy", insert: "/privacy", hint: "Privacy notice" },
  { label: "quit", insert: "/quit", hint: "Exit Gemini CLI" }
];

// Common commands for Hermes Agent TUI. Source:
// https://hermes-agent.nousresearch.com/docs/reference/slash-commands
// (fetched 2026-04-22).
const HERMES_ENTRIES: Entry[] = [
  { label: "help", insert: "/help", hint: "Show help" },
  { label: "new", insert: "/new", hint: "Start fresh session" },
  { label: "clear", insert: "/clear", hint: "Wipe screen, fresh session" },
  { label: "reset", insert: "/reset", hint: "Alias for /new" },
  { label: "resume", insert: "/resume", hint: "Restore named session" },
  { label: "branch", insert: "/branch", hint: "Branch from current" },
  { label: "retry", insert: "/retry", hint: "Resend last message" },
  { label: "undo", insert: "/undo", hint: "Drop last user/assistant pair" },
  { label: "save", insert: "/save", hint: "Persist conversation" },
  { label: "history", insert: "/history", hint: "Past exchanges" },
  { label: "title", insert: "/title", hint: "Name the session" },
  { label: "compress", insert: "/compress", hint: "Summarize context" },
  { label: "status", insert: "/status", hint: "Session info" },
  { label: "stop", insert: "/stop", hint: "Kill background work" },
  { label: "queue", insert: "/queue", hint: "Schedule next-turn prompt" },
  { label: "background", insert: "/background", hint: "Run in background" },
  { label: "btw", insert: "/btw", hint: "Ephemeral side question" },
  { label: "config", insert: "/config", hint: "Show config" },
  { label: "model", insert: "/model", hint: "Switch model" },
  { label: "provider", insert: "/provider", hint: "List providers" },
  { label: "personality", insert: "/personality", hint: "Personality overlay" },
  { label: "fast", insert: "/fast", hint: "Toggle fast mode" },
  { label: "reasoning", insert: "/reasoning", hint: "Reasoning effort" },
  { label: "skin", insert: "/skin", hint: "Display theme" },
  { label: "yolo", insert: "/yolo", hint: "Skip dangerous-cmd prompts" },
  { label: "tools", insert: "/tools", hint: "Manage tools" },
  { label: "skills", insert: "/skills", hint: "Manage skills" },
  { label: "browser", insert: "/browser", hint: "Chrome CDP connection" },
  { label: "cron", insert: "/cron", hint: "Scheduled tasks" },
  { label: "plugins", insert: "/plugins", hint: "List plugins" },
  { label: "usage", insert: "/usage", hint: "Tokens + cost" },
  { label: "insights", insert: "/insights", hint: "30-day analytics" },
  { label: "copy", insert: "/copy", hint: "Copy last response" },
  { label: "paste", insert: "/paste", hint: "Attach clipboard image" },
  { label: "image", insert: "/image", hint: "Attach image file" },
  { label: "debug", insert: "/debug", hint: "Upload debug report" },
  { label: "quit", insert: "/quit", hint: "Leave the CLI" }
];

// Common commands for aider. Source:
// https://aider.chat/docs/usage/commands.html (fetched 2026-04-22).
const AIDER_ENTRIES: Entry[] = [
  { label: "help", insert: "/help", hint: "Ask questions about aider" },
  { label: "add", insert: "/add", hint: "Add files to the chat" },
  { label: "drop", insert: "/drop", hint: "Remove files from chat" },
  { label: "ls", insert: "/ls", hint: "List known files" },
  { label: "ask", insert: "/ask", hint: "Question without editing" },
  { label: "code", insert: "/code", hint: "Request code changes" },
  { label: "architect", insert: "/architect", hint: "Architect+editor mode" },
  { label: "clear", insert: "/clear", hint: "Clear chat history" },
  { label: "reset", insert: "/reset", hint: "Drop files + clear chat" },
  { label: "undo", insert: "/undo", hint: "Undo last aider commit" },
  { label: "commit", insert: "/commit", hint: "Commit outside edits" },
  { label: "diff", insert: "/diff", hint: "Show changes since last msg" },
  { label: "git", insert: "/git", hint: "Run a git command" },
  { label: "run", insert: "/run", hint: "Run a shell command" },
  { label: "test", insert: "/test", hint: "Run tests, share failures" },
  { label: "lint", insert: "/lint", hint: "Lint & fix files" },
  { label: "map", insert: "/map", hint: "Print repo map" },
  { label: "model", insert: "/model", hint: "Switch main model" },
  { label: "editor-model", insert: "/editor-model", hint: "Switch editor model" },
  { label: "tokens", insert: "/tokens", hint: "Context token count" },
  { label: "paste", insert: "/paste", hint: "Paste clipboard" },
  { label: "copy", insert: "/copy", hint: "Copy last assistant msg" },
  { label: "read-only", insert: "/read-only", hint: "Mark files reference-only" },
  { label: "web", insert: "/web", hint: "Scrape URL to markdown" },
  { label: "voice", insert: "/voice", hint: "Voice dictation" },
  { label: "settings", insert: "/settings", hint: "Print current settings" },
  { label: "exit", insert: "/exit", hint: "Exit aider" },
  { label: "quit", insert: "/quit", hint: "Exit aider" }
];

// Static shell-idle starters. Shared between the `/` trigger (explicit
// opt-in) and the `bare` trigger (type-ahead without sigil). Kept tight —
// history from the backend fills in the long tail per host.
export const SHELL_IDLE_STATIC_ENTRIES: Entry[] = [
  { label: "claude", insert: "claude", hint: "Start Claude Code" },
  { label: "claude --resume", insert: "claude --resume", hint: "Resume last session" },
  { label: "claude --continue", insert: "claude --continue", hint: "Continue most recent" },
  { label: "codex", insert: "codex", hint: "Start Codex CLI" },
  { label: "aider", insert: "aider", hint: "Start aider" },
  { label: "gemini", insert: "gemini", hint: "Start Gemini CLI" },
  { label: "git status", insert: "git status" },
  { label: "git log --oneline -10", insert: "git log --oneline -10" },
  { label: "git diff", insert: "git diff" },
  { label: "git pull --rebase", insert: "git pull --rebase" },
  { label: "git push", insert: "git push" },
  { label: 'git commit -m ""', insert: 'git commit -m ""', hint: "Caret lands inside quotes" },
  { label: "gh pr create", insert: "gh pr create" },
  { label: "gh pr list", insert: "gh pr list" },
  { label: "npm run dev", insert: "npm run dev" },
  { label: "npm run build", insert: "npm run build" },
  { label: "npm test", insert: "npm test" },
  { label: "pnpm dev", insert: "pnpm dev" },
  { label: "pnpm install", insert: "pnpm install" },
  { label: "docker compose up -d", insert: "docker compose up -d" },
  { label: "docker compose down", insert: "docker compose down" },
  { label: "docker ps", insert: "docker ps" },
  { label: "ssh ", insert: "ssh ", hint: "Caret ready for host" },
  { label: "htop", insert: "htop" },
  { label: "systemctl status", insert: "systemctl status" },
  { label: "journalctl -fu", insert: "journalctl -fu " },
  { label: "tail -f", insert: "tail -f " }
];

export const CATALOG: Bucket[] = [
  {
    trigger: "/",
    state: "shell_idle",
    entries: SHELL_IDLE_STATIC_ENTRIES
  },
  // Bare-trigger mirror of the `/` bucket — populated at lookup time with
  // history merged in (see resolveBucketWithDynamic below).
  {
    trigger: "bare",
    state: "shell_idle",
    entries: SHELL_IDLE_STATIC_ENTRIES
  },
  { trigger: "/", state: "tui", cmd: "claude", entries: CLAUDE_CODE_ENTRIES },
  { trigger: "/", state: "tui", cmd: "codex", entries: CODEX_ENTRIES },
  { trigger: "/", state: "tui", cmd: "gemini", entries: GEMINI_ENTRIES },
  { trigger: "/", state: "tui", cmd: "hermes", entries: HERMES_ENTRIES },
  { trigger: "/", state: "tui", cmd: "aider", entries: AIDER_ENTRIES }
];

const matchBucket = (
  b: Bucket,
  trigger: Trigger,
  state: ShellState,
  cmd: string
): "exact" | "fallback" | null => {
  if (b.trigger !== trigger || b.state !== state) return null;
  if (b.cmd != null) return b.cmd === cmd ? "exact" : null;
  return "fallback";
};

/**
 * Lookup order: (trigger,state,cmd) exact → (trigger,state) fallback → none.
 * Never mixes entries across buckets.
 */
export function resolveBucket(trigger: Trigger, state: ShellState, cmd: string): Bucket | null {
  let fallback: Bucket | null = null;
  for (const b of CATALOG) {
    const m = matchBucket(b, trigger, state, cmd);
    if (m === "exact") return b;
    if (m === "fallback" && fallback === null) fallback = b;
  }
  return fallback;
}

/**
 * Merge shell-history entries on top of a static bucket's entries. History
 * entries that already exist verbatim in the static list are skipped so the
 * hand-curated hints keep their labels. Order: static entries first (stable top-of-list anchors),
 * then history by descending score.
 */
export function mergeHistoryIntoEntries(
  staticEntries: Entry[],
  history: ReadonlyArray<{ cmd: string }>
): Entry[] {
  const seen = new Set<string>();
  for (const e of staticEntries) seen.add(e.insert);
  const out: Entry[] = [...staticEntries];
  for (const h of history) {
    if (seen.has(h.cmd)) continue;
    seen.add(h.cmd);
    out.push({ label: h.cmd, insert: h.cmd, hint: "history" });
  }
  return out;
}

// Subsequence fuzzy: every char of `needle` appears in `hay` in order.
// Returns a rough score (lower = better) or -1 if no match. Contiguous
// matches and earlier positions score better.
const subsequenceScore = (hay: string, needle: string): number => {
  let hi = 0;
  let score = 0;
  let lastHit = -1;
  for (let ni = 0; ni < needle.length; ni++) {
    const c = needle[ni];
    let found = -1;
    while (hi < hay.length) {
      if (hay[hi] === c) {
        found = hi;
        hi++;
        break;
      }
      hi++;
    }
    if (found === -1) return -1;
    // Gap from previous hit adds cost; start position adds a small cost.
    if (lastHit === -1) {
      score += found; // preferring early starts
    } else {
      score += (found - lastHit - 1) * 2;
    }
    lastHit = found;
  }
  return score;
};

/**
 * Filter + rank:
 *   - Empty prefix → first MAX_ENTRIES as-is (bucket order is curated).
 *   - Prefix match wins over subsequence match (predictable for short input).
 *   - Subsequence is the fuzzy tier for non-prefix matches.
 */
export function filterEntries(entries: Entry[], prefix: string): Entry[] {
  const needle = prefix.toLowerCase();
  if (!needle) return entries.slice(0, MAX_ENTRIES);
  interface Scored {
    entry: Entry;
    tier: 0 | 1; // 0 = prefix, 1 = subsequence
    score: number;
    origIndex: number;
  }
  const scored: Scored[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const hay = e.label.toLowerCase();
    if (hay.startsWith(needle)) {
      scored.push({ entry: e, tier: 0, score: 0, origIndex: i });
      continue;
    }
    const sub = subsequenceScore(hay, needle);
    if (sub >= 0) {
      scored.push({ entry: e, tier: 1, score: sub, origIndex: i });
    }
  }
  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.score !== b.score) return a.score - b.score;
    return a.origIndex - b.origIndex;
  });
  return scored.slice(0, MAX_ENTRIES).map((s) => s.entry);
}

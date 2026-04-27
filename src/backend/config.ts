export interface RuntimeConfig {
  port: number;
  host: string;
  password?: string;
  defaultSession: string;
  scrollbackLines: number;
  pollIntervalMs: number;
  token: string;
  frontendDir: string;
  /**
   * Max size per file for `/api/files/upload`. Default 100 MiB; override via
   * `TM_AGENT_FILES_MAX_UPLOAD_MB`. Prevents a single request from filling
   * the disk.
   */
  filesMaxUploadBytes: number;
  /**
   * Absolute path that caps the new-session wizard's directory browser and
   * the `new_session` cwd. Users cannot browse above or start a session
   * outside this root. Defaults to `os.homedir()` — narrower roots are an
   * install-time choice (shared-account hosts, multi-tenant VPSes).
   *
   * The trust boundary intentionally stops at the picker — once a session
   * is running, the shell itself can `cd` anywhere the backend user can.
   * This is a UX guardrail, not a security one.
   */
  workspaceRoot: string;
  /**
   * URL path prefix that all REST, WebSocket, and static routes mount under.
   * Empty string means mount at root (the default, for subdomain deploys);
   * a value like `/tmux` lets the app live behind a reverse proxy at
   * `https://host.example/tmux/` without conflicting with other apps.
   *
   * Normalized form: either empty string or `/foo[/bar]` — leading slash,
   * no trailing slash. Normalization happens in `normalizeBasePath()` and
   * must run on every input that touches this field (CLI flag, env var).
   *
   * Optional because older test fixtures (and pre-ADR-0018 embedders)
   * omit it — the server treats missing/undefined as empty string.
   */
  basePath?: string;
}

export interface CliArgs {
  port: number;
  password?: string;
  requirePassword: boolean;
  session: string;
  scrollback: number;
  debugLog?: string;
  workspaceRoot?: string;
  basePath?: string;
}

/**
 * Normalize a user-supplied URL prefix into the canonical form used by the
 * rest of the backend: empty string for root-mount, or `/segment[/...]`
 * with a leading slash and no trailing slash. Accepts `""`, `"/"`, `"/foo"`,
 * `"foo"`, `"/foo/"` and produces the same output for all equivalent inputs.
 */
export const normalizeBasePath = (raw: string | undefined): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/") return "";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
};

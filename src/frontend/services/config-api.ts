import { apiUrl } from "../lib/base-url.js";

export interface ServerConfig {
  passwordRequired: boolean;
  scrollbackLines: number;
  pollIntervalMs: number;
  /**
   * Absolute path the backend uses as the upper bound for the directory
   * picker. The frontend picker treats this as the virtual "/" so the user
   * can't browse above it. Null only on pre-ADR-0017 backends — callers
   * should fall back to `"~"` in that case.
   */
  workspaceRoot?: string;
  /**
   * URL path prefix the backend is mounted under. Empty string for
   * root-mount, `/tmux` for subpath deploys (ADR-0018). Absent on older
   * backends — frontend should default to empty.
   */
  basePath?: string;
}

export async function fetchServerConfig(): Promise<ServerConfig> {
  const res = await fetch(apiUrl("api/config"));
  if (!res.ok) {
    throw new Error(`/api/config responded ${res.status}`);
  }
  return (await res.json()) as ServerConfig;
}

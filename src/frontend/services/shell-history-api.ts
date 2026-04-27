import { apiUrl } from "../lib/base-url.js";
import { useAuthStore } from "../stores/auth-store.js";

export interface ShellHistoryEntry {
  cmd: string;
  score: number;
}

const TOKEN_HEADER = "x-tm-agent-token";
const PASSWORD_HEADER = "x-tm-agent-password";

const authHeaders = (): HeadersInit => {
  const { token, password } = useAuthStore.getState();
  const headers: Record<string, string> = {};
  if (token) headers[TOKEN_HEADER] = token;
  if (password) headers[PASSWORD_HEADER] = password;
  return headers;
};

export async function fetchShellHistory(): Promise<ShellHistoryEntry[]> {
  const res = await fetch(apiUrl("api/shell-history/"), { headers: authHeaders() });
  if (!res.ok) throw new Error(`shell-history ${res.status}`);
  const body = (await res.json()) as { entries: ShellHistoryEntry[] };
  return body.entries;
}

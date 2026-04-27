import { apiUrl } from "../lib/base-url.js";
import { useAuthStore } from "../stores/auth-store.js";

const TOKEN_HEADER = "x-tm-agent-token";

export interface DirEntry {
  name: string;
  isHidden: boolean;
  isSymlink: boolean;
}

export interface BrowseResponse {
  path: string;
  /** Null when `path` is the workspace root. */
  parent: string | null;
  /** Workspace root enforced by the backend (ADR-0017). */
  root: string;
  entries: DirEntry[];
  /** Present when readdir failed with EACCES; entries is []. */
  readError?: string;
}

export class FsPickerError extends Error {
  public constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "FsPickerError";
  }
}

const authHeaders = (): HeadersInit => {
  const { token } = useAuthStore.getState();
  const headers: Record<string, string> = {};
  if (token) headers[TOKEN_HEADER] = token;
  return headers;
};

const jsonOrThrow = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    let body: { error?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // non-JSON error body
    }
    throw new FsPickerError(res.status, body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
};

export async function browseDirectory(path: string): Promise<BrowseResponse> {
  const usp = new URLSearchParams({ path });
  const res = await fetch(apiUrl(`api/fs-picker/browse?${usp.toString()}`), {
    headers: authHeaders()
  });
  return jsonOrThrow<BrowseResponse>(res);
}

export async function makeDirectory(path: string, name: string): Promise<{ path: string }> {
  const res = await fetch(apiUrl("api/fs-picker/mkdir"), {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ path, name })
  });
  return jsonOrThrow<{ path: string }>(res);
}

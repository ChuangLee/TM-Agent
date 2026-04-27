import { apiUrl } from "../lib/base-url.js";
import { useAuthStore } from "../stores/auth-store.js";

export type FileKind = "file" | "directory" | "other";

export interface FileListItem {
  name: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
  isSymlink: boolean;
}

export interface FileListing {
  root: string;
  rel: string;
  items: FileListItem[];
}

export interface FileMeta {
  root: string;
  rel: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
  mime: string;
  isSymlink: boolean;
}

const TOKEN_HEADER = "x-tm-agent-token";
const PASSWORD_HEADER = "x-tm-agent-password";

export class FilesApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly kind?: string
  ) {
    super(message);
    this.name = "FilesApiError";
  }
}

const authHeaders = (): HeadersInit => {
  const { token, password } = useAuthStore.getState();
  const headers: Record<string, string> = {};
  if (token) headers[TOKEN_HEADER] = token;
  if (password) headers[PASSWORD_HEADER] = password;
  return headers;
};

/**
 * Build a URL with token/password query params instead of headers. Required
 * for `<img src>` / `<iframe src>` / `<video src>` consumption since those
 * tags can't attach custom headers. Treat the result as read-only.
 */
export const buildAuthedMediaUrl = (path: string, query: Record<string, string>): string => {
  const { token, password } = useAuthStore.getState();
  const usp = new URLSearchParams({ ...query });
  if (token) usp.set("token", token);
  if (password) usp.set("password", password);
  return apiUrl(`${path}?${usp.toString()}`);
};

const jsonOrThrow = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    let body: { error?: string; kind?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // Non-JSON error body — fall through with generic text.
    }
    throw new FilesApiError(res.status, body.error ?? `${res.status} ${res.statusText}`, body.kind);
  }
  return (await res.json()) as T;
};

export async function fetchFileList(paneId: string, rel: string): Promise<FileListing> {
  const usp = new URLSearchParams({ paneId, rel });
  const res = await fetch(apiUrl(`api/files/list?${usp.toString()}`), {
    headers: authHeaders()
  });
  return jsonOrThrow<FileListing>(res);
}

export async function fetchFileMeta(paneId: string, rel: string): Promise<FileMeta> {
  const usp = new URLSearchParams({ paneId, rel });
  const res = await fetch(apiUrl(`api/files/meta?${usp.toString()}`), {
    headers: authHeaders()
  });
  return jsonOrThrow<FileMeta>(res);
}

export interface DeleteResult {
  rel: string;
  kind: FileKind;
}

export async function deleteFile(
  paneId: string,
  rel: string,
  opts: { recursive?: boolean } = {}
): Promise<DeleteResult> {
  const usp = new URLSearchParams({ paneId, rel });
  if (opts.recursive) usp.set("recursive", "1");
  const res = await fetch(apiUrl(`api/files/?${usp.toString()}`), {
    method: "DELETE",
    headers: authHeaders()
  });
  return jsonOrThrow<DeleteResult>(res);
}

export interface RenameResult {
  from: string;
  to: string;
}

export async function renameFile(
  paneId: string,
  from: string,
  to: string,
  opts: { overwrite?: boolean } = {}
): Promise<RenameResult> {
  const usp = new URLSearchParams({ paneId });
  const res = await fetch(apiUrl(`api/files/rename?${usp.toString()}`), {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ from, to, overwrite: !!opts.overwrite })
  });
  return jsonOrThrow<RenameResult>(res);
}

export async function fetchFileText(paneId: string, rel: string): Promise<string> {
  const usp = new URLSearchParams({ paneId, rel });
  const res = await fetch(apiUrl(`api/files/raw?${usp.toString()}`), {
    headers: authHeaders()
  });
  if (!res.ok) {
    throw new FilesApiError(res.status, `${res.status} ${res.statusText}`);
  }
  return await res.text();
}

export interface UploadOptions {
  paneId: string;
  relDir: string;
  /** Truthy → server prepends `<ISO-ts>-` to filename (attachment path). */
  stamp?: boolean;
  /** Allow overwriting an existing file at the target path. */
  overwrite?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface UploadResult {
  written: { rel: string; size: number }[];
}

/**
 * Upload a single File via XHR (XMLHttpRequest) rather than fetch so we can
 * observe upload progress. fetch's request-side progress API is not widely
 * available as of 2026 — XHR remains the portable path for upload UX.
 */
export function uploadFile(file: File, opts: UploadOptions): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const usp = new URLSearchParams({ paneId: opts.paneId, rel: opts.relDir });
    if (opts.stamp) usp.set("stamp", "1");
    if (opts.overwrite) usp.set("overwrite", "1");

    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(`api/files/upload?${usp.toString()}`));
    const { token, password } = useAuthStore.getState();
    if (token) xhr.setRequestHeader(TOKEN_HEADER, token);
    if (password) xhr.setRequestHeader(PASSWORD_HEADER, password);

    xhr.upload.onprogress = (e) => {
      if (opts.onProgress && e.lengthComputable) {
        opts.onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResult);
        } catch {
          reject(new FilesApiError(xhr.status, "invalid JSON response"));
        }
      } else {
        let kind: string | undefined;
        let message = `${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string; kind?: string };
          message = body.error ?? message;
          kind = body.kind;
        } catch {
          // fall through
        }
        reject(new FilesApiError(xhr.status, message, kind));
      }
    };
    xhr.onerror = () => reject(new FilesApiError(0, "network error"));
    xhr.onabort = () => reject(new FilesApiError(0, "aborted"));

    if (opts.signal) {
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(form);
  });
}

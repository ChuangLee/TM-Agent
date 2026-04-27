import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import mime from "mime-types";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { PathGuardError, resolveInsideRoot } from "./path-guard.js";

export interface FileListItem {
  name: string;
  kind: "file" | "directory" | "other";
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
  kind: "file" | "directory" | "other";
  size: number;
  mtimeMs: number;
  mime: string;
  isSymlink: boolean;
}

export async function listDirectory(root: string, rel: string): Promise<FileListing> {
  const resolved = await resolveInsideRoot(root, rel, { mustExist: true });
  const st = await fs.stat(resolved.abs);
  if (!st.isDirectory()) {
    throw new PathGuardError("escape", `not a directory: ${rel}`);
  }
  const dirents = await fs.readdir(resolved.abs, { withFileTypes: true });
  const items: FileListItem[] = [];
  for (const d of dirents) {
    const absChild = path.join(resolved.abs, d.name);
    try {
      const childStat = await fs.stat(absChild);
      items.push({
        name: d.name,
        kind: childStat.isFile() ? "file" : childStat.isDirectory() ? "directory" : "other",
        size: childStat.size,
        mtimeMs: childStat.mtimeMs,
        isSymlink: d.isSymbolicLink()
      });
    } catch {
      // Broken symlink or race — surface as "other" with 0 size.
      items.push({
        name: d.name,
        kind: "other",
        size: 0,
        mtimeMs: 0,
        isSymlink: d.isSymbolicLink()
      });
    }
  }
  items.sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === "directory") return -1;
      if (b.kind === "directory") return 1;
    }
    return a.name.localeCompare(b.name);
  });
  return { root: resolved.rootAbs, rel: resolved.rel, items };
}

export async function statPath(root: string, rel: string): Promise<FileMeta> {
  const resolved = await resolveInsideRoot(root, rel, { mustExist: true });
  const st = await fs.stat(resolved.abs);
  const lst = await fs.lstat(resolved.abs);
  const kind = st.isFile() ? "file" : st.isDirectory() ? "directory" : "other";
  const mimeGuess = kind === "file" ? mime.lookup(resolved.abs) || "application/octet-stream" : "";
  return {
    root: resolved.rootAbs,
    rel: resolved.rel,
    kind,
    size: st.size,
    mtimeMs: st.mtimeMs,
    mime: mimeGuess,
    isSymlink: lst.isSymbolicLink()
  };
}

export interface OpenReadResult {
  abs: string;
  size: number;
  mtimeMs: number;
  mime: string;
  stream: Readable;
}

/** Open a file for streaming read, with byte Range support handled by caller. */
export async function openFileForRead(
  root: string,
  rel: string,
  opts: { start?: number; end?: number } = {}
): Promise<OpenReadResult> {
  const resolved = await resolveInsideRoot(root, rel, { mustExist: true });
  const st = await fs.stat(resolved.abs);
  if (!st.isFile()) {
    throw new PathGuardError("escape", `not a file: ${rel}`);
  }
  const mimeGuess = mime.lookup(resolved.abs) || "application/octet-stream";
  const stream = createReadStream(resolved.abs, {
    ...(opts.start !== undefined ? { start: opts.start } : {}),
    ...(opts.end !== undefined ? { end: opts.end } : {})
  });
  return {
    abs: resolved.abs,
    size: st.size,
    mtimeMs: st.mtimeMs,
    mime: mimeGuess,
    stream
  };
}

export interface WriteResult {
  rel: string;
  size: number;
}

export interface WriteOptions {
  overwrite: boolean;
}

/**
 * Stream an incoming Readable to a file under root+rel. Target parent dir is
 * created with `mkdir -p`. Returns the relative path and final size.
 *
 * The path guard rejects any rel that escapes root (including via symlink)
 * BEFORE any bytes are written, so a malicious client can't race a symlink
 * swap between check and write.
 */
export async function writeFile(
  root: string,
  rel: string,
  source: Readable,
  opts: WriteOptions
): Promise<WriteResult> {
  try {
    const resolved = await resolveInsideRoot(root, rel, { mustExist: false });
    const parent = path.dirname(resolved.abs);
    await fs.mkdir(parent, { recursive: true });
    // Re-resolve the parent to catch TOCTOU symlink substitutions: the mkdir
    // above could have followed a newly-created symlink. Verifying the real
    // parent is still inside root closes that window.
    await resolveInsideRoot(root, path.relative(resolved.rootAbs, parent), {
      mustExist: true
    });

    let exists = false;
    try {
      await fs.stat(resolved.abs);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists && !opts.overwrite) {
      const err = new Error(`file exists: ${resolved.rel}`) as Error & { code?: string };
      err.code = "EEXIST_CONFLICT";
      throw err;
    }

    const dest = createWriteStream(resolved.abs);
    await pipeline(source, dest);
    const final = await fs.stat(resolved.abs);
    return { rel: resolved.rel, size: final.size };
  } catch (error) {
    // If we threw before pipeline consumed `source`, busboy's file stream
    // would stall forever and never emit "close" on the parent parser.
    // Draining it unblocks busboy so the route handler can respond. Safe to
    // call on an already-consumed stream — it's a no-op then.
    source.resume();
    throw error;
  }
}

export interface DeleteResult {
  rel: string;
  kind: "file" | "directory" | "other";
}

/**
 * Delete a file or directory under `root/rel`. Directories require
 * `recursive: true`; otherwise a non-empty directory throws ENOTEMPTY which
 * the route maps to 409. Root itself (rel === "") cannot be deleted.
 */
export async function deletePath(
  root: string,
  rel: string,
  opts: { recursive?: boolean } = {}
): Promise<DeleteResult> {
  const resolved = await resolveInsideRoot(root, rel, { mustExist: true });
  if (resolved.rel === "") {
    throw new PathGuardError("escape", "refusing to delete root itself");
  }
  const st = await fs.lstat(resolved.abs);
  const kind: DeleteResult["kind"] = st.isFile()
    ? "file"
    : st.isDirectory()
      ? "directory"
      : "other";
  if (kind === "directory") {
    if (opts.recursive) {
      await fs.rm(resolved.abs, { recursive: true, force: false });
    } else {
      // rmdir surfaces ENOTEMPTY cleanly; fs.rm with recursive:false throws
      // ERR_FS_EISDIR instead, which is harder to map to a useful HTTP code.
      await fs.rmdir(resolved.abs);
    }
  } else {
    // Files + symlinks — unlink works for both and follows lstat semantics
    // (deletes the link, not the target).
    await fs.unlink(resolved.abs);
  }
  return { rel: resolved.rel, kind };
}

export interface RenameResult {
  from: string;
  to: string;
}

/**
 * Rename `from` → `to` within the same root. Both sides must pass the path
 * guard. Refuses to overwrite unless `overwrite: true`. `to` may reference a
 * not-yet-existing target (the path guard's `mustExist: false` branch walks
 * up to verify the destination parent is contained).
 */
export async function renamePath(
  root: string,
  fromRel: string,
  toRel: string,
  opts: { overwrite?: boolean } = {}
): Promise<RenameResult> {
  const src = await resolveInsideRoot(root, fromRel, { mustExist: true });
  if (src.rel === "") {
    throw new PathGuardError("escape", "refusing to rename root itself");
  }
  const dst = await resolveInsideRoot(root, toRel, { mustExist: false });
  if (dst.rel === "") {
    throw new PathGuardError("escape", "refusing to overwrite root");
  }
  if (dst.abs === src.abs) {
    return { from: src.rel, to: dst.rel };
  }
  if (!opts.overwrite) {
    let exists = false;
    try {
      await fs.lstat(dst.abs);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) {
      const err = new Error(`target exists: ${dst.rel}`) as Error & { code?: string };
      err.code = "EEXIST_CONFLICT";
      throw err;
    }
  }
  await fs.mkdir(path.dirname(dst.abs), { recursive: true });
  await fs.rename(src.abs, dst.abs);
  return { from: src.rel, to: dst.rel };
}

const ILLEGAL_NAME_CHARS = /[^A-Za-z0-9._\-\u4e00-\u9fff]/g;

/**
 * Sanitize a user-supplied filename for the attachments path. Keeps ASCII
 * alphanumerics, `._-`, and CJK Unified Ideographs so Chinese filenames
 * survive; everything else collapses to `_`. Empty results fall back to
 * `file`.
 */
export function sanitizeFilename(raw: string | undefined): string {
  const base = (raw ?? "").replace(/[\\/]/g, "_").trim();
  const clean = base.replace(ILLEGAL_NAME_CHARS, "_").replace(/_+/g, "_");
  const trimmed = clean.replace(/^[_.]+/, "").replace(/[_]+$/, "");
  return trimmed || "file";
}

/**
 * Build the `<ISO-ts>-<sanitized>` filename used by the compose attachment
 * flow. Colons in the ISO timestamp are replaced (`:` breaks some shells +
 * Windows FAT32). Milliseconds are dropped to shorten. The `now` arg is
 * injected for deterministic tests.
 */
export function buildStampedFilename(
  rawName: string | undefined,
  mimeType: string | undefined,
  now: Date = new Date()
): string {
  const iso = now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-\d{3}Z$/, "Z");
  let name = sanitizeFilename(rawName);
  if (!path.extname(name)) {
    const extFromMime = mimeType ? mime.extension(mimeType) : false;
    if (extFromMime) name = `${name}.${extFromMime}`;
  }
  return `${iso}-${name}`;
}

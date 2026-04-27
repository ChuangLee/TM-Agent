import fs from "node:fs/promises";
import path from "node:path";

/**
 * Resolve a user-supplied `rel` path against an absolute `root` and return
 * the concrete on-disk path iff it is contained within `root` (including when
 * symlinks are followed). Throws {@link PathGuardError} for every rejection
 * case so callers can map to HTTP 403 uniformly.
 *
 * Containment rule:
 *   realpath(candidate) === realpath(root)
 *   || realpath(candidate).startsWith(realpath(root) + sep)
 *
 * Both sides are `realpath`'d — a symlink inside root that points outside is
 * rejected even though its lexical path looks clean. The same guard applies
 * to the root itself; if root is a symlink, we resolve it and use the target
 * as the canonical containment base.
 *
 * `mustExist=false` is used on upload-target parents: we need to validate the
 * would-be-parent is contained, but it may not exist yet (mkdir -p fixes that
 * separately). In that case we walk up until a real directory is found and
 * check containment of *that* ancestor, then ensure the remaining tail does
 * not traverse outside via `..`.
 */
export class PathGuardError extends Error {
  public constructor(
    public readonly kind:
      | "empty_root"
      | "root_missing"
      | "root_not_directory"
      | "escape"
      | "absolute_rel"
      | "invalid_segment",
    message: string
  ) {
    super(message);
    this.name = "PathGuardError";
  }
}

export interface ResolveOptions {
  /** When true, target must already exist (list / read / download). */
  mustExist: boolean;
}

/** Fully-resolved path inside the guarded root. */
export interface Resolved {
  /** Canonical absolute path after all symlink resolution. */
  abs: string;
  /** Canonical absolute root (post-realpath). */
  rootAbs: string;
  /** Path relative to rootAbs, normalized, forward slashes. */
  rel: string;
}

const ALLOW_PATH_SEGMENT = /^[^/\\\0]+$/;

const normalizeRel = (rel: string): string => {
  const trimmed = (rel ?? "").trim();
  if (trimmed === "" || trimmed === "." || trimmed === "/") return "";
  // Strip a single leading slash so callers can use "" or "/" or "sub/dir"
  // interchangeably, but reject absolute-looking paths with a drive prefix.
  const stripped = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  if (path.isAbsolute(stripped)) {
    throw new PathGuardError("absolute_rel", `rel must be relative: ${rel}`);
  }
  return stripped;
};

/**
 * Resolve a request target (root + rel) into a canonical on-disk path,
 * enforcing the containment rule. Throws `PathGuardError` on every rejection.
 */
export async function resolveInsideRoot(
  root: string,
  rel: string,
  opts: ResolveOptions
): Promise<Resolved> {
  if (!root || root.trim() === "") {
    throw new PathGuardError("empty_root", "root is empty");
  }
  if (!path.isAbsolute(root)) {
    throw new PathGuardError("empty_root", `root must be absolute: ${root}`);
  }

  const rootReal = await realpathOrThrow(root);
  const rootStat = await fs.stat(rootReal);
  if (!rootStat.isDirectory()) {
    throw new PathGuardError("root_not_directory", `root is not a directory: ${root}`);
  }

  const normalizedRel = normalizeRel(rel);

  // Segment-level sanity: forbid `..` walks BEFORE the realpath dance. This
  // catches the attack before it touches the FS and avoids relying on
  // realpath to reject (it wouldn't — `foo/../../etc` resolves cleanly).
  if (normalizedRel !== "") {
    for (const segment of normalizedRel.split(/[/\\]/)) {
      if (segment === "" || segment === "." || segment === "..") {
        throw new PathGuardError(
          "escape",
          `rel contains forbidden segment: ${JSON.stringify(segment)}`
        );
      }
      if (!ALLOW_PATH_SEGMENT.test(segment)) {
        throw new PathGuardError(
          "invalid_segment",
          `rel has invalid characters in segment: ${JSON.stringify(segment)}`
        );
      }
    }
  }

  const lexical = path.resolve(rootReal, normalizedRel);

  if (opts.mustExist) {
    const abs = await realpathOrThrow(lexical);
    assertContained(abs, rootReal);
    const relOut = normalizedRel === "" ? "" : path.relative(rootReal, abs).replace(/\\/g, "/");
    return { abs, rootAbs: rootReal, rel: relOut };
  }

  // mustExist=false (upload write target): walk up until a real directory is
  // found, realpath that, and verify both (a) the real ancestor is contained
  // AND (b) the un-existing tail doesn't traverse upward (already guaranteed
  // by the segment check, but re-asserted below).
  const { existingAbs, tail } = await findExistingAncestor(lexical);
  const existingReal = await realpathOrThrow(existingAbs);
  assertContained(existingReal, rootReal);

  const finalAbs = tail === "" ? existingReal : path.join(existingReal, tail);
  // After join, re-check that the final candidate (lexically) stays inside
  // rootReal. This protects against subtle cases where `tail` contained a
  // traversal that slipped through (it can't, but defense-in-depth is free).
  assertContained(finalAbs, rootReal);

  const relOut = normalizedRel === "" ? "" : path.relative(rootReal, finalAbs).replace(/\\/g, "/");
  return { abs: finalAbs, rootAbs: rootReal, rel: relOut };
}

async function realpathOrThrow(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new PathGuardError("root_missing", `path does not exist: ${p}`);
    }
    throw error;
  }
}

function assertContained(candidate: string, rootReal: string): void {
  if (candidate === rootReal) return;
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (!candidate.startsWith(prefix)) {
    throw new PathGuardError("escape", `path escapes root: ${candidate} vs ${rootReal}`);
  }
}

async function findExistingAncestor(
  target: string
): Promise<{ existingAbs: string; tail: string }> {
  let cur = target;
  const tailParts: string[] = [];
  // Walk up; stop when cur exists as a directory (or when we hit the FS root).
  // The caller's segment-level check already rejects `..`, so tail cannot
  // contain traversal.
  for (;;) {
    try {
      const stat = await fs.stat(cur);
      if (stat.isDirectory()) {
        return { existingAbs: cur, tail: tailParts.reverse().join(path.sep) };
      }
      // Path exists as a file — return its parent as the ancestor, with the
      // filename as the tail (useful for overwrite checks upstream).
      tailParts.push(path.basename(cur));
      return {
        existingAbs: path.dirname(cur),
        tail: tailParts.reverse().join(path.sep)
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      const parent = path.dirname(cur);
      if (parent === cur) {
        throw new PathGuardError("root_missing", `no existing ancestor for ${target}`);
      }
      tailParts.push(path.basename(cur));
      cur = parent;
    }
  }
}

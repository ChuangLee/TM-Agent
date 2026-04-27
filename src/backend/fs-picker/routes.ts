import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import express, { Router, type Request } from "express";
import type { AuthService } from "../auth/auth-service.js";
import { buildHttpAuthMiddleware } from "../files/http-auth.js";

/**
 * Directory picker used by the NewSessionSheet wizard (ADR-0014 §6,
 * ADR-0017 §2). Unlike `/api/files/*` which is anchored to a pane's cwd,
 * this router lets the authenticated user browse the filesystem — but only
 * within the install-configured workspace root (default: `$HOME`). The root
 * is a UX guardrail, not a security boundary: once a session is running the
 * shell can `cd` anywhere the backend user can. What the root buys you is
 * preventing a user from *accidentally* starting a session in `/etc` or
 * `/tmp/someone-elses-stuff` via the picker on a shared-account host.
 *
 * Path normalization: `~` expands to `$HOME`. `path.resolve(...)` collapses
 * `..` and yields a canonical absolute path. We then enforce that the
 * resolved path is the root itself or a descendant; otherwise reject with
 * 403.
 */

export interface FsPickerRoutesDeps {
  authService: AuthService;
  workspaceRoot: string;
  logger?: Pick<Console, "log" | "error">;
}

export interface DirEntry {
  name: string;
  isHidden: boolean;
  isSymlink: boolean;
}

export interface BrowseResponse {
  /** Canonical absolute path the response describes. */
  path: string;
  /** Parent directory, or null when `path` is the workspace root. */
  parent: string | null;
  /**
   * Workspace root enforced by the backend. The frontend picker treats this
   * as the virtual "/" — it disables the up button and the Home shortcut
   * at this level.
   */
  root: string;
  entries: DirEntry[];
}

const expandHome = (p: string): string => {
  const trimmed = p.trim();
  if (trimmed === "") return homedir();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return path.join(homedir(), trimmed.slice(2));
  return trimmed;
};

const isWithinRoot = (candidate: string, root: string): boolean => {
  if (candidate === root) return true;
  const rel = path.relative(root, candidate);
  if (rel === "") return true;
  // path.relative returns `..` or `../foo` when the candidate escapes root;
  // on Windows it also returns an absolute path when drives differ, which
  // also shouldn't happen on our Linux target but guard anyway.
  if (rel.startsWith("..")) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
};

const getQueryString = (req: Request, name: string): string => {
  const v = req.query[name];
  if (Array.isArray(v)) return String(v[0] ?? "");
  return typeof v === "string" ? v : "";
};

const ILLEGAL_NAME = /[\0/\\]/;

const validateMkdirName = (name: string): string | null => {
  const trimmed = name.trim();
  if (!trimmed) return "name required";
  if (trimmed === "." || trimmed === "..") return "reserved name";
  if (ILLEGAL_NAME.test(trimmed)) return "illegal character in name";
  if (trimmed.length > 255) return "name too long";
  return null;
};

export function buildFsPickerRouter(deps: FsPickerRoutesDeps): Router {
  const router = Router();
  const { workspaceRoot } = deps;
  router.use(buildHttpAuthMiddleware(deps.authService));

  router.get("/browse", (req, res, next) => {
    void (async () => {
      try {
        const raw = getQueryString(req, "path");
        // Empty path = browse the root. Any explicit path goes through
        // expandHome + resolve + sandbox check.
        const resolved = raw.trim() === "" ? workspaceRoot : path.resolve(expandHome(raw));

        if (!isWithinRoot(resolved, workspaceRoot)) {
          res.status(403).json({
            error: `path is outside workspace root: ${workspaceRoot}`
          });
          return;
        }

        let stat;
        try {
          stat = await fs.stat(resolved);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            res.status(404).json({ error: `path does not exist: ${resolved}` });
            return;
          }
          if (code === "EACCES" || code === "EPERM") {
            res.status(403).json({ error: `permission denied: ${resolved}` });
            return;
          }
          throw error;
        }
        if (!stat.isDirectory()) {
          res.status(400).json({ error: `not a directory: ${resolved}` });
          return;
        }

        let dirents;
        try {
          dirents = await fs.readdir(resolved, { withFileTypes: true });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EACCES" || code === "EPERM") {
            res.status(200).json({
              path: resolved,
              parent: resolved === workspaceRoot ? null : path.dirname(resolved),
              root: workspaceRoot,
              entries: [],
              readError: "permission denied"
            } satisfies BrowseResponse & { readError: string });
            return;
          }
          throw error;
        }

        const entries: DirEntry[] = [];
        for (const d of dirents) {
          let isDir = d.isDirectory();
          const isSymlink = d.isSymbolicLink();
          if (!isDir && isSymlink) {
            try {
              const s = await fs.stat(path.join(resolved, d.name));
              isDir = s.isDirectory();
            } catch {
              continue;
            }
          }
          if (!isDir) continue;
          entries.push({
            name: d.name,
            isHidden: d.name.startsWith("."),
            isSymlink
          });
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));

        // Parent is null when we're AT the root — the picker uses this to
        // disable its "up" button. Above the root is unreachable.
        const parent = resolved === workspaceRoot ? null : path.dirname(resolved);
        const response: BrowseResponse = {
          path: resolved,
          parent,
          root: workspaceRoot,
          entries
        };
        res.json(response);
      } catch (error) {
        next(error);
      }
    })();
  });

  router.post("/mkdir", express.json(), (req, res, next) => {
    void (async () => {
      try {
        const body = (req.body ?? {}) as { path?: unknown; name?: unknown };
        const parentRaw = typeof body.path === "string" ? body.path : "";
        const nameRaw = typeof body.name === "string" ? body.name : "";
        const validation = validateMkdirName(nameRaw);
        if (validation) {
          res.status(400).json({ error: validation });
          return;
        }
        const parentResolved =
          parentRaw.trim() === "" ? workspaceRoot : path.resolve(expandHome(parentRaw));

        if (!isWithinRoot(parentResolved, workspaceRoot)) {
          res.status(403).json({
            error: `path is outside workspace root: ${workspaceRoot}`
          });
          return;
        }

        const parentStat = await fs.stat(parentResolved).catch(() => null);
        if (!parentStat || !parentStat.isDirectory()) {
          res.status(400).json({ error: `parent is not a directory: ${parentResolved}` });
          return;
        }
        const target = path.join(parentResolved, nameRaw.trim());
        try {
          await fs.mkdir(target);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EEXIST") {
            res.status(409).json({ error: `already exists: ${target}` });
            return;
          }
          if (code === "EACCES" || code === "EPERM") {
            res.status(403).json({ error: `permission denied: ${target}` });
            return;
          }
          throw error;
        }
        res.json({ path: target });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}

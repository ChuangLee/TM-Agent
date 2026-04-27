import { Router, type Request, type RequestHandler } from "express";
import Busboy from "busboy";
import type { AuthService } from "../auth/auth-service.js";
import type { TmuxStateSnapshot } from "../../shared/protocol.js";
import { buildHttpAuthMiddleware } from "./http-auth.js";
import { PaneCwdError, resolvePaneCwd } from "./pane-cwd-resolver.js";
import {
  buildStampedFilename,
  deletePath,
  listDirectory,
  openFileForRead,
  renamePath,
  statPath,
  writeFile,
  type WriteResult
} from "./file-service.js";
import { PathGuardError } from "./path-guard.js";

export interface FileRoutesDeps {
  authService: AuthService;
  getSnapshot(): TmuxStateSnapshot | undefined;
  maxUploadBytes: number;
  logger?: Pick<Console, "log" | "error">;
}

type AsyncHandler = (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>;

const wrap =
  (fn: AsyncHandler, logger?: FileRoutesDeps["logger"]): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch((error: unknown) => {
      logger?.error("files route error", req.path, error);
      if (!res.headersSent) mapErrorToResponse(error, res);
      else next(error);
    });
  };

const mapErrorToResponse = (error: unknown, res: Parameters<RequestHandler>[1]): void => {
  if (error instanceof PathGuardError) {
    res.status(403).json({ error: error.message, kind: error.kind });
    return;
  }
  if (error instanceof PaneCwdError) {
    const status = error.kind === "pane_not_found" ? 404 : 503;
    res.status(status).json({ error: error.message, kind: error.kind });
    return;
  }
  const code = (error as { code?: string }).code;
  if (code === "EEXIST_CONFLICT") {
    res.status(409).json({ error: (error as Error).message, kind: "exists" });
    return;
  }
  if (code === "ENOTEMPTY") {
    res.status(409).json({
      error: "directory is not empty — pass recursive=1 to force",
      kind: "not_empty"
    });
    return;
  }
  if (code === "ENOENT") {
    res.status(404).json({ error: (error as Error).message, kind: "not_found" });
    return;
  }
  res.status(500).json({
    error: error instanceof Error ? error.message : "internal error"
  });
};

const getPaneRoot = (deps: FileRoutesDeps, paneId: string): string => {
  return resolvePaneCwd(deps.getSnapshot(), paneId);
};

const getQueryString = (req: Request, name: string): string => {
  const v = req.query[name];
  if (Array.isArray(v)) return String(v[0] ?? "");
  return typeof v === "string" ? v : "";
};

export function buildFilesRouter(deps: FileRoutesDeps): Router {
  const router = Router();
  router.use(buildHttpAuthMiddleware(deps.authService));

  router.get(
    "/list",
    wrap(async (req, res) => {
      const paneId = getQueryString(req, "paneId");
      const rel = getQueryString(req, "rel");
      if (!paneId) {
        res.status(400).json({ error: "paneId required" });
        return;
      }
      const root = getPaneRoot(deps, paneId);
      const listing = await listDirectory(root, rel);
      res.json(listing);
    }, deps.logger)
  );

  router.get(
    "/meta",
    wrap(async (req, res) => {
      const paneId = getQueryString(req, "paneId");
      const rel = getQueryString(req, "rel");
      if (!paneId) {
        res.status(400).json({ error: "paneId required" });
        return;
      }
      const root = getPaneRoot(deps, paneId);
      const meta = await statPath(root, rel);
      res.json(meta);
    }, deps.logger)
  );

  const streamFile = async (
    req: Request,
    res: Parameters<RequestHandler>[1],
    asDownload: boolean
  ): Promise<void> => {
    const paneId = getQueryString(req, "paneId");
    const rel = getQueryString(req, "rel");
    if (!paneId) {
      res.status(400).json({ error: "paneId required" });
      return;
    }
    const root = getPaneRoot(deps, paneId);
    const rangeHeader = req.headers.range;
    const meta = await statPath(root, rel);
    if (meta.kind !== "file") {
      res.status(400).json({ error: "target is not a file" });
      return;
    }
    let start = 0;
    let end = meta.size - 1;
    let isPartial = false;
    if (rangeHeader && /^bytes=/.test(rangeHeader)) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (m) {
        const a = m[1] === "" ? undefined : Number.parseInt(m[1], 10);
        const b = m[2] === "" ? undefined : Number.parseInt(m[2], 10);
        if (a === undefined && b !== undefined) {
          // suffix-byte-range: last N bytes
          start = Math.max(0, meta.size - b);
          end = meta.size - 1;
        } else {
          start = a ?? 0;
          end = b ?? meta.size - 1;
        }
        if (start > end || start >= meta.size) {
          res.status(416).setHeader("Content-Range", `bytes */${meta.size}`).end();
          return;
        }
        isPartial = true;
      }
    }
    const open = await openFileForRead(root, rel, { start, end });
    res.setHeader("Content-Type", open.mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(end - start + 1));
    if (isPartial) {
      res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${meta.size}`);
    }
    if (asDownload) {
      const name = encodeURIComponent(rel.split("/").pop() ?? "download");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${name}"; filename*=UTF-8''${name}`
      );
    }
    open.stream.on("error", (err) => {
      deps.logger?.error("raw stream error", err);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    open.stream.pipe(res);
  };

  router.get(
    "/raw",
    wrap((req, res) => streamFile(req, res, false), deps.logger)
  );

  router.get(
    "/download",
    wrap((req, res) => streamFile(req, res, true), deps.logger)
  );

  router.delete(
    "/",
    wrap(async (req, res) => {
      const paneId = getQueryString(req, "paneId");
      const rel = getQueryString(req, "rel");
      const recursive = getQueryString(req, "recursive") === "1";
      if (!paneId) {
        res.status(400).json({ error: "paneId required" });
        return;
      }
      if (!rel) {
        res.status(400).json({ error: "rel required" });
        return;
      }
      const root = getPaneRoot(deps, paneId);
      const result = await deletePath(root, rel, { recursive });
      res.json(result);
    }, deps.logger)
  );

  router.post(
    "/rename",
    wrap(async (req, res) => {
      const paneId = getQueryString(req, "paneId");
      if (!paneId) {
        res.status(400).json({ error: "paneId required" });
        return;
      }
      const body = (req.body ?? {}) as {
        from?: unknown;
        to?: unknown;
        overwrite?: unknown;
      };
      const from = typeof body.from === "string" ? body.from : "";
      const to = typeof body.to === "string" ? body.to : "";
      const overwrite = body.overwrite === true;
      if (!from || !to) {
        res.status(400).json({ error: "from + to required" });
        return;
      }
      const root = getPaneRoot(deps, paneId);
      const result = await renamePath(root, from, to, { overwrite });
      res.json(result);
    }, deps.logger)
  );

  router.post("/upload", (req, res, next) => {
    const handle = async (): Promise<void> => {
      const paneId = getQueryString(req, "paneId");
      const rel = getQueryString(req, "rel");
      const overwrite = getQueryString(req, "overwrite") === "1";
      const stamp = getQueryString(req, "stamp") === "1";
      if (!paneId) {
        res.status(400).json({ error: "paneId required" });
        return;
      }
      let root: string;
      try {
        root = getPaneRoot(deps, paneId);
      } catch (error) {
        mapErrorToResponse(error, res);
        return;
      }
      let bb: Busboy.Busboy;
      try {
        bb = Busboy({
          headers: req.headers,
          // Browsers (Chrome/Safari on macOS in particular) put raw UTF-8
          // bytes straight into the Content-Disposition `filename=`
          // parameter. Busboy defaults to latin1 and mangles them — "中.txt"
          // arrives as "ä¸­.txt". Tell it to decode as utf8 instead.
          defParamCharset: "utf8",
          limits: { fileSize: deps.maxUploadBytes }
        });
      } catch (error) {
        mapErrorToResponse(error, res);
        return;
      }

      const written: WriteResult[] = [];
      const pending: Promise<void>[] = [];
      let rejected = false;
      let rejectionPayload: { status: number; body: Record<string, unknown> } | undefined;

      const rejectWith = (status: number, body: Record<string, unknown>): void => {
        if (rejected) return;
        rejected = true;
        rejectionPayload = { status, body };
        // Intentionally do NOT `req.unpipe(bb)` — busboy needs to keep
        // consuming the request until EOF to emit "close". Unpiping
        // strands the parser and hangs the response. Remaining file parts
        // are drained in the `file` handler when `rejected` is set.
      };

      bb.on("file", (_name, stream, info) => {
        if (rejected) {
          stream.resume();
          return;
        }
        const filename = stamp
          ? buildStampedFilename(info.filename, info.mimeType)
          : (info.filename ?? "file");
        const targetRel = rel ? `${rel.replace(/\/$/, "")}/${filename}` : filename;

        let truncated = false;
        stream.on("limit", () => {
          truncated = true;
          rejectWith(413, { error: "file exceeds max upload size" });
        });

        const p = writeFile(root, targetRel, stream, { overwrite })
          .then((w) => {
            if (truncated) {
              // The partial file is on disk; best-effort cleanup is left to
              // the user since we can't safely remove without another path
              // check.
              return;
            }
            written.push(w);
          })
          .catch((error) => {
            if (error instanceof PathGuardError) {
              rejectWith(403, { error: error.message, kind: error.kind });
            } else if ((error as { code?: string }).code === "EEXIST_CONFLICT") {
              rejectWith(409, { error: (error as Error).message, kind: "exists" });
            } else {
              rejectWith(500, {
                error: error instanceof Error ? error.message : "internal error"
              });
            }
          });
        pending.push(p);
      });

      bb.on("error", (error) => {
        rejectWith(500, { error: String(error) });
      });

      bb.on("close", () => {
        void (async () => {
          await Promise.allSettled(pending);
          if (rejected && rejectionPayload) {
            res.status(rejectionPayload.status).json(rejectionPayload.body);
            return;
          }
          res.json({ written });
        })();
      });

      req.pipe(bb);
    };
    handle().catch(next);
  });

  return router;
}

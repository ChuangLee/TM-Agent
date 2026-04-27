import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { AuthService } from "../../../src/backend/auth/auth-service.js";
import { buildShellHistoryRouter } from "../../../src/backend/shell-history/routes.js";

// The router reads $HISTFILE / ~/.bash_history / ~/.zsh_history. To keep the
// test isolated from the real host, we redirect HOME + HISTFILE to a
// scratch dir and seed controlled content.

describe("shell-history router", () => {
  let tmp: string;
  let origHome: string | undefined;
  let origHistfile: string | undefined;
  let app: express.Express;
  const auth = new AuthService(undefined, "test-token");

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "shell-history-"));
    origHome = process.env.HOME;
    origHistfile = process.env.HISTFILE;
    process.env.HOME = tmp;
    delete process.env.HISTFILE;
    // Seed both bash + zsh style files. zsh extended_history prefixes the
    // command with `: epoch:duration;cmd` — the router must strip that.
    await fs.writeFile(
      path.join(tmp, ".bash_history"),
      ["ls -la", "git status", "git status", "claude", "claude --resume", ""].join("\n")
    );
    await fs.writeFile(
      path.join(tmp, ".zsh_history"),
      [": 1711000000:0;htop", ": 1711000001:0;npm test", "# a comment"].join("\n")
    );

    app = express();
    app.use("/api/shell-history", buildShellHistoryRouter({ authService: auth }));
  });

  afterEach(async () => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origHistfile === undefined) delete process.env.HISTFILE;
    else process.env.HISTFILE = origHistfile;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("401 without token", async () => {
    // Bypass the cached result from a prior test run by forcing a fresh
    // endpoint instance — achieved by hitting the request once with correct
    // auth first is NOT required; the auth check runs before cache lookup.
    const res = await request(app).get("/api/shell-history/");
    expect(res.status).toBe(401);
  });

  test("returns entries from bash + zsh history with metadata stripped", async () => {
    const res = await request(app).get("/api/shell-history/").set("x-tm-agent-token", "test-token");
    expect(res.status).toBe(200);
    const cmds = (res.body.entries as Array<{ cmd: string }>).map((e) => e.cmd);
    expect(cmds).toContain("ls -la");
    expect(cmds).toContain("git status");
    expect(cmds).toContain("claude");
    expect(cmds).toContain("claude --resume");
    // zsh metadata lines stripped down to just the command:
    expect(cmds).toContain("htop");
    expect(cmds).toContain("npm test");
    // Comment lines must be skipped:
    expect(cmds.some((c) => c.startsWith("#"))).toBe(false);
  });

  test("entries are scored and deduped", async () => {
    const res = await request(app).get("/api/shell-history/").set("x-tm-agent-token", "test-token");
    const entries = res.body.entries as Array<{ cmd: string; score: number }>;
    const git = entries.find((e) => e.cmd === "git status");
    expect(git).toBeDefined();
    // `git status` was seeded twice — the loader should dedupe (one entry)
    // and its frequency count should nudge it above a never-seen baseline.
    const gitCount = entries.filter((e) => e.cmd === "git status").length;
    expect(gitCount).toBe(1);
    expect(git?.score ?? 0).toBeGreaterThan(0);
    // Sort invariant: descending by score.
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].score).toBeGreaterThanOrEqual(entries[i].score);
    }
  });
});

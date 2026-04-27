import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import { AuthService } from "../../../src/backend/auth/auth-service.js";
import { buildFsPickerRouter } from "../../../src/backend/fs-picker/routes.js";

describe("fs-picker router", () => {
  let tmp: string;
  let realTmp: string;
  let app: express.Express;
  const auth = new AuthService(undefined, "test-token");

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fs-picker-"));
    // macOS / some Linux setups make /tmp a symlink; the router resolves
    // with path.resolve (which keeps symlinks) so we compare against both.
    realTmp = await fs.realpath(tmp).catch(() => tmp);
    await fs.mkdir(path.join(tmp, "alpha"));
    await fs.mkdir(path.join(tmp, "alpha", "child"));
    await fs.mkdir(path.join(tmp, "beta"));
    await fs.mkdir(path.join(tmp, ".hidden"));
    await fs.writeFile(path.join(tmp, "file.txt"), "ignore me");
    app = express();
    app.use("/fs-picker", buildFsPickerRouter({ authService: auth, workspaceRoot: tmp }));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("browse returns only directories, sorted, with hidden flag", async () => {
    const res = await request(app)
      .get("/fs-picker/browse")
      .query({ path: tmp, token: "test-token" });
    expect(res.status).toBe(200);
    expect([tmp, realTmp]).toContain(res.body.path);
    expect(res.body.entries.map((e: { name: string }) => e.name)).toEqual([
      ".hidden",
      "alpha",
      "beta"
    ]);
    const hidden = res.body.entries.find((e: { name: string }) => e.name === ".hidden");
    expect(hidden.isHidden).toBe(true);
    expect(res.body.entries.some((e: { name: string }) => e.name === "file.txt")).toBe(false);
  });

  test("browse returns root when path is empty, parent is null at root", async () => {
    const res = await request(app).get("/fs-picker/browse").query({ token: "test-token" });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(tmp);
    expect(res.body.parent).toBeNull();
    expect(res.body.root).toBe(tmp);
  });

  test("browse sets parent for directories below root, null at root", async () => {
    const atRoot = await request(app)
      .get("/fs-picker/browse")
      .query({ path: tmp, token: "test-token" });
    expect(atRoot.body.parent).toBeNull();
    expect(atRoot.body.root).toBe(tmp);

    const belowRoot = await request(app)
      .get("/fs-picker/browse")
      .query({ path: path.join(tmp, "alpha"), token: "test-token" });
    expect(belowRoot.body.parent).toBe(tmp);
  });

  test("browse rejects paths outside the workspace root with 403", async () => {
    const res = await request(app)
      .get("/fs-picker/browse")
      .query({ path: path.dirname(tmp), token: "test-token" });
    expect(res.status).toBe(403);
    expect(String(res.body.error)).toMatch(/workspace root/);
  });

  test("browse rejects `..` escape attempts", async () => {
    const res = await request(app)
      .get("/fs-picker/browse")
      .query({ path: path.join(tmp, "..", "..", "etc"), token: "test-token" });
    expect(res.status).toBe(403);
  });

  test("browse 404s on missing path within root", async () => {
    const res = await request(app)
      .get("/fs-picker/browse")
      .query({ path: path.join(tmp, "does-not-exist"), token: "test-token" });
    expect(res.status).toBe(404);
  });

  test("browse 400s when path is a file", async () => {
    const res = await request(app)
      .get("/fs-picker/browse")
      .query({ path: path.join(tmp, "file.txt"), token: "test-token" });
    expect(res.status).toBe(400);
  });

  test("browse rejects unauthenticated requests", async () => {
    const res = await request(app).get("/fs-picker/browse").query({ path: tmp });
    expect(res.status).toBe(401);
  });

  test("mkdir creates a directory in the given parent (inside root)", async () => {
    const res = await request(app)
      .post("/fs-picker/mkdir")
      .set("x-tm-agent-token", "test-token")
      .send({ path: tmp, name: "gamma" });
    expect(res.status).toBe(200);
    const stat = await fs.stat(path.join(tmp, "gamma"));
    expect(stat.isDirectory()).toBe(true);
  });

  test("mkdir 409s on collision", async () => {
    const res = await request(app)
      .post("/fs-picker/mkdir")
      .set("x-tm-agent-token", "test-token")
      .send({ path: tmp, name: "alpha" });
    expect(res.status).toBe(409);
  });

  test("mkdir rejects names with slashes or nulls", async () => {
    const bad = await request(app)
      .post("/fs-picker/mkdir")
      .set("x-tm-agent-token", "test-token")
      .send({ path: tmp, name: "../evil" });
    expect(bad.status).toBe(400);
    const empty = await request(app)
      .post("/fs-picker/mkdir")
      .set("x-tm-agent-token", "test-token")
      .send({ path: tmp, name: "  " });
    expect(empty.status).toBe(400);
  });

  test("mkdir 403s when parent is outside the workspace root", async () => {
    const res = await request(app)
      .post("/fs-picker/mkdir")
      .set("x-tm-agent-token", "test-token")
      .send({ path: path.dirname(tmp), name: "gamma" });
    expect(res.status).toBe(403);
  });

  test("mkdir rejects unauthenticated requests", async () => {
    const res = await request(app).post("/fs-picker/mkdir").send({ path: tmp, name: "gamma" });
    expect(res.status).toBe(401);
  });
});

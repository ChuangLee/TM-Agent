import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PathGuardError, resolveInsideRoot } from "../../../src/backend/files/path-guard.js";

describe("path-guard", () => {
  let tmp: string;
  let root: string;
  let outsideTmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pathguard-"));
    root = path.join(tmp, "cwd");
    outsideTmp = path.join(tmp, "outside");
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outsideTmp, { recursive: true });
    await fs.writeFile(path.join(root, "hello.txt"), "hi");
    await fs.mkdir(path.join(root, "sub"));
    await fs.writeFile(path.join(root, "sub", "nested.txt"), "nested");
    await fs.writeFile(path.join(outsideTmp, "secret.txt"), "secret");
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  describe("happy paths", () => {
    test("empty rel returns root itself", async () => {
      const r = await resolveInsideRoot(root, "", { mustExist: true });
      expect(r.rel).toBe("");
      expect(await fs.realpath(r.abs)).toBe(await fs.realpath(root));
    });

    test(`rel="/" is equivalent to empty`, async () => {
      const r = await resolveInsideRoot(root, "/", { mustExist: true });
      expect(r.rel).toBe("");
    });

    test(`rel="." is equivalent to empty`, async () => {
      const r = await resolveInsideRoot(root, ".", { mustExist: true });
      expect(r.rel).toBe("");
    });

    test("file inside root", async () => {
      const r = await resolveInsideRoot(root, "hello.txt", { mustExist: true });
      expect(r.rel).toBe("hello.txt");
      expect(r.abs).toBe(path.join(await fs.realpath(root), "hello.txt"));
    });

    test("nested file", async () => {
      const r = await resolveInsideRoot(root, "sub/nested.txt", { mustExist: true });
      expect(r.rel).toBe("sub/nested.txt");
    });

    test("leading slash is stripped", async () => {
      const r = await resolveInsideRoot(root, "/hello.txt", { mustExist: true });
      expect(r.rel).toBe("hello.txt");
    });
  });

  describe("traversal rejection", () => {
    test("rejects ..", async () => {
      await expect(resolveInsideRoot(root, "..", { mustExist: true })).rejects.toBeInstanceOf(
        PathGuardError
      );
    });

    test("rejects ../outside", async () => {
      await expect(
        resolveInsideRoot(root, "../outside/secret.txt", { mustExist: true })
      ).rejects.toMatchObject({ kind: "escape" });
    });

    test("rejects sub/../../outside", async () => {
      await expect(
        resolveInsideRoot(root, "sub/../../outside/secret.txt", { mustExist: true })
      ).rejects.toMatchObject({ kind: "escape" });
    });

    test("rejects absolute path with leading slash pointing outside", async () => {
      // After stripping leading "/", this becomes "etc/passwd" — treated as
      // relative to root, should fail to resolve (mustExist: true).
      await expect(
        resolveInsideRoot(root, "/etc/passwd", { mustExist: true })
      ).rejects.toBeInstanceOf(PathGuardError);
    });

    test("rejects null byte", async () => {
      await expect(
        resolveInsideRoot(root, "hello.txt\u0000.md", { mustExist: true })
      ).rejects.toBeInstanceOf(PathGuardError);
    });
  });

  describe("symlink escape", () => {
    test("symlink to outside root is rejected", async () => {
      const linkPath = path.join(root, "escape-link");
      await fs.symlink(outsideTmp, linkPath, "dir");
      await expect(
        resolveInsideRoot(root, "escape-link/secret.txt", { mustExist: true })
      ).rejects.toMatchObject({ kind: "escape" });
    });

    test("symlink to a file outside root is rejected", async () => {
      const linkPath = path.join(root, "evil.txt");
      await fs.symlink(path.join(outsideTmp, "secret.txt"), linkPath);
      await expect(resolveInsideRoot(root, "evil.txt", { mustExist: true })).rejects.toMatchObject({
        kind: "escape"
      });
    });

    test("symlink pointing *inside* root is allowed", async () => {
      const linkPath = path.join(root, "alias.txt");
      await fs.symlink(path.join(root, "hello.txt"), linkPath);
      const r = await resolveInsideRoot(root, "alias.txt", { mustExist: true });
      expect(r.abs).toBe(path.join(await fs.realpath(root), "hello.txt"));
    });

    test("root itself is a symlink", async () => {
      const realRoot = path.join(tmp, "real-root");
      await fs.mkdir(realRoot);
      await fs.writeFile(path.join(realRoot, "a.txt"), "a");
      const linkedRoot = path.join(tmp, "linked-root");
      await fs.symlink(realRoot, linkedRoot, "dir");

      const r = await resolveInsideRoot(linkedRoot, "a.txt", { mustExist: true });
      expect(r.abs).toBe(path.join(await fs.realpath(realRoot), "a.txt"));
      expect(r.rootAbs).toBe(await fs.realpath(realRoot));
    });
  });

  describe("mustExist=false (upload target)", () => {
    test("accepts rel pointing to a non-existent file in existing dir", async () => {
      const r = await resolveInsideRoot(root, "newfile.txt", { mustExist: false });
      expect(r.rel).toBe("newfile.txt");
    });

    test("accepts rel pointing to non-existent nested path", async () => {
      const r = await resolveInsideRoot(root, "msg-upload/x.png", { mustExist: false });
      expect(r.rel).toBe("msg-upload/x.png");
    });

    test("rejects traversal in non-existent path", async () => {
      await expect(
        resolveInsideRoot(root, "msg-upload/../../etc/passwd", { mustExist: false })
      ).rejects.toMatchObject({ kind: "escape" });
    });

    test("rejects when an existing ancestor is a symlink escaping root", async () => {
      const escapeDir = path.join(root, "escape-dir");
      await fs.symlink(outsideTmp, escapeDir, "dir");
      await expect(
        resolveInsideRoot(root, "escape-dir/newfile.txt", { mustExist: false })
      ).rejects.toMatchObject({ kind: "escape" });
    });
  });

  describe("root validation", () => {
    test("empty root rejected", async () => {
      await expect(resolveInsideRoot("", "x", { mustExist: true })).rejects.toMatchObject({
        kind: "empty_root"
      });
    });

    test("relative root rejected", async () => {
      await expect(resolveInsideRoot("./relative", "x", { mustExist: true })).rejects.toMatchObject(
        { kind: "empty_root" }
      );
    });

    test("missing root rejected", async () => {
      await expect(
        resolveInsideRoot(path.join(tmp, "nope"), "x", { mustExist: true })
      ).rejects.toMatchObject({ kind: "root_missing" });
    });

    test("file as root rejected", async () => {
      const filePath = path.join(tmp, "notadir");
      await fs.writeFile(filePath, "x");
      await expect(resolveInsideRoot(filePath, "x", { mustExist: true })).rejects.toMatchObject({
        kind: "root_not_directory"
      });
    });
  });

  describe("missing target when mustExist=true", () => {
    test("rejects with root_missing", async () => {
      await expect(
        resolveInsideRoot(root, "does-not-exist.txt", { mustExist: true })
      ).rejects.toMatchObject({ kind: "root_missing" });
    });
  });
});

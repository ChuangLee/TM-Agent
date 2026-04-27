import express from "express";
import { describe, expect, test } from "vitest";
import { normalizeBasePath } from "../../src/backend/config.js";
import { frontendFallbackRoute, isWebSocketPath } from "../../src/backend/server.js";

interface RouteLayer {
  route?: { path?: string };
  match(path: string): boolean;
}

const getFallbackLayer = (): RouteLayer => {
  const app = express();
  app.get(frontendFallbackRoute, () => undefined);

  const stack = (app.router as { stack: RouteLayer[] }).stack;
  const layer = stack.find((entry) => entry.route?.path === frontendFallbackRoute);
  if (!layer) {
    throw new Error("fallback route layer not found");
  }
  return layer;
};

describe("frontend fallback route", () => {
  test("matches root and deep SPA paths", () => {
    const layer = getFallbackLayer();
    expect(layer.match("/")).toBe(true);
    expect(layer.match("/session/work/window/2")).toBe(true);
  });

  test("reserves websocket paths for upgrade handling", () => {
    expect(isWebSocketPath("/ws/control")).toBe(true);
    expect(isWebSocketPath("/ws/terminal")).toBe(true);
    expect(isWebSocketPath("/api/config")).toBe(false);
    expect(isWebSocketPath("/ws")).toBe(false);
  });

  test("isWebSocketPath honours the base-path prefix", () => {
    expect(isWebSocketPath("/tmux/ws/control", "/tmux")).toBe(true);
    expect(isWebSocketPath("/tmux/ws/terminal", "/tmux")).toBe(true);
    // Without the prefix, paths that used to match at root are no longer
    // WS endpoints under a subpath mount — the frontend must address the
    // prefixed form and the upgrade handler rejects anything else.
    expect(isWebSocketPath("/ws/control", "/tmux")).toBe(false);
    expect(isWebSocketPath("/tmux/api/config", "/tmux")).toBe(false);
  });
});

describe("normalizeBasePath (ADR-0018)", () => {
  test("collapses root-equivalent inputs to the empty string", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("   ")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
  });

  test("produces a leading-slash, no-trailing-slash canonical form", () => {
    expect(normalizeBasePath("tmux")).toBe("/tmux");
    expect(normalizeBasePath("/tmux")).toBe("/tmux");
    expect(normalizeBasePath("/tmux/")).toBe("/tmux");
    expect(normalizeBasePath("  /tmux/  ")).toBe("/tmux");
    expect(normalizeBasePath("/a/b")).toBe("/a/b");
    expect(normalizeBasePath("/a/b/")).toBe("/a/b");
  });
});

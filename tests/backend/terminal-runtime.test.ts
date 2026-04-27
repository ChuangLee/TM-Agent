import { describe, expect, test } from "vitest";
import { TerminalRuntime } from "../../src/backend/pty/terminal-runtime.js";
import { FakePtyFactory } from "../harness/fakePty.js";

describe("terminal runtime", () => {
  test("spawns the PTY at the last known dimensions", () => {
    const factory = new FakePtyFactory();
    const runtime = new TerminalRuntime(factory);

    runtime.resize(140, 50);
    runtime.attachToSession("main");

    expect(factory.spawnDimensions.at(0)).toEqual({ cols: 140, rows: 50 });
  });

  test("prefers dimensions passed directly to attachToSession", () => {
    const factory = new FakePtyFactory();
    const runtime = new TerminalRuntime(factory);

    runtime.resize(100, 30);
    runtime.attachToSession("main", { cols: 160, rows: 48 });

    expect(factory.spawnDimensions.at(0)).toEqual({ cols: 160, rows: 48 });
  });

  test("re-attaching to the same session respawns the PTY for a fresh tmux redraw", () => {
    // Mode-change remount path: the frontend re-dispatches select_session so
    // backend fires a fresh tmux-attach, which in turn emits the full-screen
    // redraw to the new terminal-WS. Early-returning here would leave the
    // fresh xterm with only the capture-pane seed; tmux's cursor position
    // wouldn't re-assert and subsequent CSI-positioned output would misalign.
    const factory = new FakePtyFactory();
    const runtime = new TerminalRuntime(factory);

    runtime.attachToSession("main", { cols: 120, rows: 40 });
    runtime.attachToSession("main", { cols: 80, rows: 24 });

    expect(factory.spawnDimensions).toEqual([
      { cols: 120, rows: 40 },
      { cols: 80, rows: 24 }
    ]);
  });

  test("ignores invalid resize values and falls back to defaults on spawn", () => {
    const factory = new FakePtyFactory();
    const runtime = new TerminalRuntime(factory);

    runtime.resize(Number.NaN, 40);
    runtime.resize(1, 1);
    runtime.attachToSession("main");

    expect(factory.spawnDimensions.at(0)).toEqual({ cols: 80, rows: 24 });
  });
});

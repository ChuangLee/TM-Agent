import { describe, expect, test, vi } from "vitest";
import { TmuxCliExecutor } from "../../src/backend/tmux/cli-executor.js";

describe("TmuxCliExecutor.capturePane", () => {
  test("passes -e when escapes are requested", async () => {
    const runTmux = vi.fn().mockResolvedValue("captured");
    const executor = new TmuxCliExecutor();
    (executor as unknown as { runTmux: typeof runTmux }).runTmux = runTmux;

    await executor.capturePane("%3", 2000, true);
    expect(runTmux).toHaveBeenCalledWith(["capture-pane", "-t", "%3", "-p", "-S", "-2000", "-e"]);
  });

  test("omits -e for raw capture", async () => {
    const runTmux = vi.fn().mockResolvedValue("captured");
    const executor = new TmuxCliExecutor();
    (executor as unknown as { runTmux: typeof runTmux }).runTmux = runTmux;

    await executor.capturePane("%3", 100, false);
    expect(runTmux).toHaveBeenCalledWith(["capture-pane", "-t", "%3", "-p", "-S", "-100"]);
  });

  test("defaults to raw capture when flag is omitted", async () => {
    const runTmux = vi.fn().mockResolvedValue("captured");
    const executor = new TmuxCliExecutor();
    (executor as unknown as { runTmux: typeof runTmux }).runTmux = runTmux;

    await executor.capturePane("%3", 100);
    expect(runTmux).toHaveBeenCalledWith(["capture-pane", "-t", "%3", "-p", "-S", "-100"]);
  });

  test("adds -E -1 when historyOnly is set (excludes visible pane)", async () => {
    const runTmux = vi.fn().mockResolvedValue("captured");
    const executor = new TmuxCliExecutor();
    (executor as unknown as { runTmux: typeof runTmux }).runTmux = runTmux;

    await executor.capturePane("%3", 10_000, true, true);
    expect(runTmux).toHaveBeenCalledWith([
      "capture-pane",
      "-t",
      "%3",
      "-p",
      "-S",
      "-10000",
      "-E",
      "-1",
      "-e"
    ]);
  });
});

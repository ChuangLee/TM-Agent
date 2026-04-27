import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SysinfoSampler } from "../../src/backend/sysinfo/sysinfo-sampler.js";
import type { SystemStatsSample } from "../../src/shared/protocol.js";

const STAT_LINES = ["cpu  100 0 50 1000 0 0 0 0 0 0", ""].join("\n");
const STAT_LINES_2 = ["cpu  200 0 100 1400 0 0 0 0 0 0", ""].join("\n");

const MEM = [
  "MemTotal:       8000000 kB",
  "MemFree:        4000000 kB",
  "MemAvailable:   5000000 kB",
  ""
].join("\n");

const LOADAVG = "1.25 1.00 0.80 2/300 12345\n";
const UPTIME = "12345.67 99999.00\n";

describe("SysinfoSampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("marks unsupported on non-linux platform", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    try {
      const onUnsupported = vi.fn();
      const sampler = new SysinfoSampler({
        intervalMs: 2000,
        onSample: vi.fn(),
        onUnsupported,
        read: vi.fn(),
        now: () => 0,
        coreCount: () => 4
      });
      await sampler.start();
      expect(onUnsupported).toHaveBeenCalledWith(expect.stringContaining("platform=darwin"));
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });

  test("emits a sample on start with CPU delta 0, then updates on tick", async () => {
    if (process.platform !== "linux") return;

    const reads: Record<string, string[]> = {
      "/proc/stat": [STAT_LINES, STAT_LINES, STAT_LINES_2],
      "/proc/meminfo": [MEM, MEM, MEM],
      "/proc/loadavg": [LOADAVG, LOADAVG, LOADAVG],
      "/proc/uptime": [UPTIME, UPTIME, UPTIME]
    };
    const callCounts: Record<string, number> = {
      "/proc/stat": 0,
      "/proc/meminfo": 0,
      "/proc/loadavg": 0,
      "/proc/uptime": 0
    };
    const read = vi.fn(async (path: string) => {
      const idx = Math.min(callCounts[path]!, reads[path]!.length - 1);
      callCounts[path]! += 1;
      return reads[path]![idx]!;
    });

    const samples: SystemStatsSample[] = [];
    let t = 1000;
    const sampler = new SysinfoSampler({
      intervalMs: 2000,
      onSample: (s) => samples.push(s),
      onUnsupported: vi.fn(),
      read,
      now: () => (t += 100),
      coreCount: () => 4
    });
    await sampler.start();

    // First sample: prevCpu primed from identical STAT_LINES → delta 0.
    expect(samples).toHaveLength(1);
    expect(samples[0]!.cpu).toBe(0);
    expect(samples[0]!.mem).toBeCloseTo((8_000_000 - 5_000_000) / 8_000_000, 5);
    expect(samples[0]!.load1).toBeCloseTo(1.25, 5);
    expect(samples[0]!.cores).toBe(4);
    expect(samples[0]!.uptimeSec).toBeCloseTo(12345.67, 3);

    // Advance the interval and flush — next tick reads STAT_LINES_2 → nonzero delta.
    await vi.advanceTimersByTimeAsync(2000);
    expect(samples.length).toBeGreaterThanOrEqual(2);
    const second = samples[1]!;
    // busy delta = (200+100) - (100+50) = 150; total delta = 1700 - 1150 = 550 → ~0.2727
    expect(second.cpu).toBeCloseTo(150 / 550, 3);

    sampler.stop();
  });
});

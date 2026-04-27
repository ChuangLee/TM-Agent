import { describe, expect, test } from "vitest";
import {
  cpuBusyFraction,
  parseCpuStat,
  parseLoad1,
  parseMemInfo,
  parseUptimeSeconds
} from "../../src/backend/sysinfo/parsers.js";

describe("parseCpuStat", () => {
  test("reads the aggregate cpu line, ignores per-core lines", () => {
    const text = [
      "cpu  100 10 50 1000 5 0 2 0 0 0",
      "cpu0 25 5 10 250 1 0 0 0 0 0",
      "cpu1 25 5 15 250 2 0 1 0 0 0",
      "intr 123",
      ""
    ].join("\n");
    const totals = parseCpuStat(text);
    // busy = user(100)+nice(10)+system(50)+irq(0)+softirq(2)+steal(0) = 162
    expect(totals.busy).toBe(162);
    // idle = idle(1000)+iowait(5) = 1005
    expect(totals.idle).toBe(1005);
    expect(totals.total).toBe(162 + 1005);
  });

  test("tolerates short tail (pre-2.6.33 kernels)", () => {
    const text = "cpu 100 0 20 500\n";
    const totals = parseCpuStat(text);
    expect(totals.busy).toBe(120);
    expect(totals.idle).toBe(500);
  });

  test("throws when aggregate cpu line absent", () => {
    expect(() => parseCpuStat("memtotal 0\n")).toThrow(/no aggregate/);
  });
});

describe("cpuBusyFraction", () => {
  test("computes busy delta / total delta", () => {
    const prev = { busy: 100, idle: 900, total: 1000 };
    const curr = { busy: 200, idle: 1300, total: 1500 };
    // delta busy = 100, delta total = 500 → 0.2
    expect(cpuBusyFraction(prev, curr)).toBeCloseTo(0.2, 5);
  });

  test("clamps non-monotonic counters to 0", () => {
    const prev = { busy: 500, idle: 500, total: 1000 };
    const curr = { busy: 400, idle: 500, total: 900 };
    expect(cpuBusyFraction(prev, curr)).toBe(0);
  });

  test("returns 0 when no time passed", () => {
    const s = { busy: 100, idle: 200, total: 300 };
    expect(cpuBusyFraction(s, s)).toBe(0);
  });
});

describe("parseMemInfo", () => {
  test("prefers MemAvailable when present", () => {
    const text = [
      "MemTotal:        8000000 kB",
      "MemFree:         2000000 kB",
      "MemAvailable:    3000000 kB",
      "Buffers:          100000 kB",
      "Cached:           500000 kB",
      ""
    ].join("\n");
    const mem = parseMemInfo(text);
    expect(mem.totalBytes).toBe(8000000 * 1024);
    expect(mem.usedBytes).toBe((8000000 - 3000000) * 1024);
  });

  test("falls back to free+buffers+cached when MemAvailable absent", () => {
    const text = [
      "MemTotal:        8000000 kB",
      "MemFree:         2000000 kB",
      "Buffers:          100000 kB",
      "Cached:           500000 kB",
      ""
    ].join("\n");
    const mem = parseMemInfo(text);
    expect(mem.totalBytes).toBe(8000000 * 1024);
    // used = total - (free + buffers + cached)
    expect(mem.usedBytes).toBe((8000000 - (2000000 + 100000 + 500000)) * 1024);
  });

  test("throws when MemTotal missing", () => {
    expect(() => parseMemInfo("MemFree: 100 kB\n")).toThrow(/MemTotal/);
  });
});

describe("parseLoad1 / parseUptimeSeconds", () => {
  test("parses first numeric field", () => {
    expect(parseLoad1("2.75 1.76 1.93 5/773 4008752")).toBeCloseTo(2.75, 5);
    expect(parseUptimeSeconds("3608979.03 11689742.64")).toBeCloseTo(3608979.03, 3);
  });

  test("rejects negative uptime", () => {
    expect(() => parseUptimeSeconds("-1 0")).toThrow();
  });
});

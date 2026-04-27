import fs from "node:fs/promises";
import os from "node:os";
import type { SystemStatsSample } from "../../shared/protocol.js";
import {
  cpuBusyFraction,
  parseCpuStat,
  parseLoad1,
  parseMemInfo,
  parseUptimeSeconds,
  type CpuTotals
} from "./parsers.js";

export type SampleReader = (path: string) => Promise<string>;

export interface SysinfoSamplerOptions {
  /** Interval in ms between samples. */
  intervalMs: number;
  /** Called on each successful sample. */
  onSample: (sample: SystemStatsSample) => void;
  /** Called once if the platform isn't Linux or /proc is unreadable at startup. */
  onUnsupported: (reason: string) => void;
  /** Called for each tick failure. */
  onError?: (error: Error) => void;
  /** Override for tests. Defaults to `fs.readFile(path, "utf8")`. */
  read?: SampleReader;
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Override for tests. Defaults to `os.cpus().length`. */
  coreCount?: () => number;
}

/**
 * Polls /proc at a fixed interval and emits SystemStatsSample through onSample.
 *
 * Why not `systeminformation` or `node-os-utils`? Both ship 100 KB+ of cross-
 * platform glue we don't need — Linux is the only deployment target, and a
 * direct /proc read is ~4 system calls (one per file). Keeping this module
 * dependency-free also makes platform gating trivial.
 *
 * The sampler is a *single* timer shared across all WS clients — the broadcast
 * fan-out is the server's job (same shape as TmuxStateMonitor). We expose a
 * `lastSample` getter so new clients can be seeded immediately without waiting
 * for the next tick.
 */
export class SysinfoSampler {
  private timer?: NodeJS.Timeout;
  private running = false;
  private prevCpu?: CpuTotals;
  private cachedLastSample?: SystemStatsSample;
  private readonly intervalMs: number;
  private readonly onSample: (sample: SystemStatsSample) => void;
  private readonly onUnsupported: (reason: string) => void;
  private readonly onError: (error: Error) => void;
  private readonly read: SampleReader;
  private readonly now: () => number;
  private readonly coreCount: () => number;

  public constructor(opts: SysinfoSamplerOptions) {
    this.intervalMs = opts.intervalMs;
    this.onSample = opts.onSample;
    this.onUnsupported = opts.onUnsupported;
    this.onError = opts.onError ?? (() => undefined);
    this.read = opts.read ?? ((path) => fs.readFile(path, "utf8"));
    this.now = opts.now ?? (() => Date.now());
    this.coreCount = opts.coreCount ?? (() => os.cpus().length || 1);
  }

  public get lastSample(): SystemStatsSample | undefined {
    return this.cachedLastSample;
  }

  public async start(): Promise<void> {
    if (process.platform !== "linux") {
      this.onUnsupported(`platform=${process.platform}`);
      return;
    }
    // Probe-and-prime: one read doubles as the "is /proc readable?" check
    // and the initial CPU baseline so the first sample has a defined delta
    // (0 by construction, since we compare the same snapshot to itself).
    try {
      const statText = await this.read("/proc/stat");
      this.prevCpu = parseCpuStat(statText);
    } catch (error) {
      this.onUnsupported(`/proc unreadable: ${(error as Error).message}`);
      return;
    }
    this.running = true;
    await this.tick();
    this.scheduleNext();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNext());
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    try {
      const [statText, memText, loadText, uptimeText] = await Promise.all([
        this.read("/proc/stat"),
        this.read("/proc/meminfo"),
        this.read("/proc/loadavg"),
        this.read("/proc/uptime")
      ]);
      const currCpu = parseCpuStat(statText);
      const cpu = this.prevCpu ? cpuBusyFraction(this.prevCpu, currCpu) : 0;
      this.prevCpu = currCpu;

      const mem = parseMemInfo(memText);
      const memFraction = mem.totalBytes > 0 ? mem.usedBytes / mem.totalBytes : 0;

      const sample: SystemStatsSample = {
        t: this.now(),
        cpu,
        mem: Math.max(0, Math.min(1, memFraction)),
        load1: parseLoad1(loadText),
        cores: this.coreCount(),
        uptimeSec: parseUptimeSeconds(uptimeText)
      };
      this.cachedLastSample = sample;
      this.onSample(sample);
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

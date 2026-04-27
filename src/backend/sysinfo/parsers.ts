/**
 * Pure parsers for /proc pseudo-files. Kept separate from the sampler so the
 * ring-buffer + interval logic is testable without touching fs.
 */

export interface CpuTotals {
  /** Ticks spent on user+nice+system+irq+softirq+steal (i.e. NOT idle/iowait). */
  busy: number;
  /** Ticks spent on idle+iowait. */
  idle: number;
  /** busy + idle. */
  total: number;
}

export interface MemInfo {
  totalBytes: number;
  usedBytes: number;
}

/**
 * Parse the aggregate `cpu` line from /proc/stat.
 *
 * Layout: `cpu  user nice system idle iowait irq softirq steal guest guest_nice`.
 * Kernels older than 2.6.33 may omit the tail fields — we tolerate missing
 * values by defaulting to 0. Throws on missing/invalid `cpu ` line so a single
 * sampler failure doesn't silently produce bogus 100% or 0% readings.
 */
export const parseCpuStat = (statText: string): CpuTotals => {
  const line = statText.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) {
    throw new Error("no aggregate `cpu ` line in /proc/stat");
  }
  const fields = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        throw new Error(`non-numeric field in /proc/stat: ${v}`);
      }
      return n;
    });
  if (fields.length < 4) {
    throw new Error(`/proc/stat cpu line too short: ${line}`);
  }
  const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = fields;
  const busy = user + nice + system + irq + softirq + steal;
  const idleTotal = idle + iowait;
  return { busy, idle: idleTotal, total: busy + idleTotal };
};

/**
 * CPU % between two /proc/stat samples. Returns a clamped 0..1.
 *
 * Counters reset only on reboot — by the time that happens our uptime sample
 * has rolled to near-zero too, so the caller can distinguish reboot from a
 * same-generation underflow. We clamp rather than throw: a transient non-
 * monotonic reading (possible on CPU hotplug or live migration) shouldn't
 * brick the sparkline.
 */
export const cpuBusyFraction = (prev: CpuTotals, curr: CpuTotals): number => {
  const totalDelta = curr.total - prev.total;
  if (totalDelta <= 0) return 0;
  const busyDelta = curr.busy - prev.busy;
  const frac = busyDelta / totalDelta;
  if (frac < 0) return 0;
  if (frac > 1) return 1;
  return frac;
};

/**
 * Parse /proc/meminfo → used/total in bytes.
 *
 * "Used" follows what `free -h` calls the `used` column: total − available.
 * `MemAvailable` is authoritative when present (kernel ≥ 3.14). On older
 * kernels we fall back to total − (free + buffers + cached), which slightly
 * over-counts but stays in the same ballpark.
 */
export const parseMemInfo = (meminfoText: string): MemInfo => {
  const kv = new Map<string, number>();
  for (const line of meminfoText.split("\n")) {
    const match = /^([A-Za-z_()]+):\s+(\d+)(?:\s+kB)?/.exec(line);
    if (match) {
      kv.set(match[1], Number(match[2]) * 1024);
    }
  }
  const total = kv.get("MemTotal");
  if (!total || total <= 0) {
    throw new Error("MemTotal missing or zero in /proc/meminfo");
  }
  const available = kv.get("MemAvailable");
  if (available !== undefined) {
    const used = Math.max(0, total - available);
    return { totalBytes: total, usedBytes: used };
  }
  const free = kv.get("MemFree") ?? 0;
  const buffers = kv.get("Buffers") ?? 0;
  const cached = kv.get("Cached") ?? 0;
  const used = Math.max(0, total - (free + buffers + cached));
  return { totalBytes: total, usedBytes: used };
};

/**
 * Parse the first field of /proc/loadavg (the 1-minute load).
 * Example content: `2.75 1.76 1.93 5/773 4008752`.
 */
export const parseLoad1 = (loadavgText: string): number => {
  const first = loadavgText.trim().split(/\s+/)[0];
  const n = Number(first);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid loadavg: ${loadavgText}`);
  }
  return n;
};

/**
 * Parse /proc/uptime → seconds since boot.
 * Example content: `3608979.03 11689742.64`.
 */
export const parseUptimeSeconds = (uptimeText: string): number => {
  const first = uptimeText.trim().split(/\s+/)[0];
  const n = Number(first);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid uptime: ${uptimeText}`);
  }
  return n;
};

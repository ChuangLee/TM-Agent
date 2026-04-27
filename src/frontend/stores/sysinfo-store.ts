import { create } from "zustand";
import type { SystemStatsSample } from "../../shared/protocol.js";

/**
 * Sysinfo store. Keeps a rolling window of the last N samples so the sidebar
 * sparklines have visible history. The backend broadcasts every ~2 s; at 30
 * samples that's 60 s of trend — matches ADR-0011's scope.
 *
 * We keep history client-side rather than asking the backend for it so a page
 * refresh doesn't force the server to rebuild a per-client replay buffer. The
 * trade-off: the sparkline starts empty after reload, filling back in over
 * the next minute. For an always-visible passive widget that's acceptable.
 */
export const SYSINFO_HISTORY_LIMIT = 30;

export interface SysinfoState {
  supported: boolean;
  samples: SystemStatsSample[];
  ingest(sample: SystemStatsSample): void;
  markUnsupported(): void;
}

/**
 * ADR-0015 §1: dedupe idle-noise samples. `/proc/stat` delta produces 0.0001
 * -scale jitter on an idle machine; re-renders driven by those changes are
 * pure waste. We round cpu/mem to 3 decimals and clamp load1 to ±0.005 before
 * comparing. `t` and `uptimeSec` are strictly increasing and visually
 * irrelevant at 2 s granularity, so excluded from the equality check.
 */
const LOAD_EPSILON = 0.005;
const FRACTION_PRECISION = 1000;

const roundFraction = (value: number): number =>
  Math.round(value * FRACTION_PRECISION) / FRACTION_PRECISION;

const isVisuallyEqual = (prev: SystemStatsSample, next: SystemStatsSample): boolean =>
  roundFraction(prev.cpu) === roundFraction(next.cpu) &&
  roundFraction(prev.mem) === roundFraction(next.mem) &&
  prev.cores === next.cores &&
  Math.abs(prev.load1 - next.load1) <= LOAD_EPSILON;

export const useSysinfoStore = create<SysinfoState>((set) => ({
  supported: true,
  samples: [],
  ingest: (sample) =>
    set((state) => {
      const prev = state.samples[state.samples.length - 1];
      if (prev && state.supported && isVisuallyEqual(prev, sample)) {
        return state;
      }
      const next =
        state.samples.length >= SYSINFO_HISTORY_LIMIT
          ? [...state.samples.slice(1), sample]
          : [...state.samples, sample];
      return { supported: true, samples: next };
    }),
  markUnsupported: () => set({ supported: false, samples: [] })
}));

export const selectLatestSample = (state: SysinfoState): SystemStatsSample | undefined =>
  state.samples[state.samples.length - 1];

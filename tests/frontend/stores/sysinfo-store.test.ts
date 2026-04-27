import { beforeEach, describe, expect, test } from "vitest";
import {
  SYSINFO_HISTORY_LIMIT,
  selectLatestSample,
  useSysinfoStore
} from "../../../src/frontend/stores/sysinfo-store.js";
import type { SystemStatsSample } from "../../../src/shared/protocol.js";

const sample = (t: number, cpu = 0.1): SystemStatsSample => ({
  t,
  cpu,
  mem: 0.5,
  load1: 1,
  cores: 4,
  uptimeSec: 60
});

describe("sysinfo-store", () => {
  beforeEach(() => {
    useSysinfoStore.setState({ supported: true, samples: [] });
  });

  test("ingest appends samples up to the history limit, then rolls", () => {
    for (let i = 0; i < SYSINFO_HISTORY_LIMIT + 5; i++) {
      useSysinfoStore.getState().ingest(sample(i, i / 100));
    }
    const { samples } = useSysinfoStore.getState();
    expect(samples).toHaveLength(SYSINFO_HISTORY_LIMIT);
    // Oldest samples dropped from the front.
    expect(samples[0]!.t).toBe(5);
    expect(samples[samples.length - 1]!.t).toBe(SYSINFO_HISTORY_LIMIT + 4);
  });

  test("markUnsupported flips the flag and clears history", () => {
    useSysinfoStore.getState().ingest(sample(1));
    useSysinfoStore.getState().markUnsupported();
    const state = useSysinfoStore.getState();
    expect(state.supported).toBe(false);
    expect(state.samples).toEqual([]);
  });

  test("ingest after markUnsupported re-enables support", () => {
    useSysinfoStore.getState().markUnsupported();
    useSysinfoStore.getState().ingest(sample(42));
    expect(useSysinfoStore.getState().supported).toBe(true);
  });

  test("selectLatestSample returns the most recent entry", () => {
    useSysinfoStore.getState().ingest(sample(1, 0.1));
    useSysinfoStore.getState().ingest(sample(2, 0.2));
    expect(selectLatestSample(useSysinfoStore.getState())?.t).toBe(2);
  });

  // ADR-0015 §1 dedup behaviour.
  describe("idle-noise dedup", () => {
    test("drops a sample whose cpu/mem/load1 are visually identical to the previous one", () => {
      useSysinfoStore.getState().ingest(sample(1, 0.1));
      useSysinfoStore.getState().ingest(sample(2, 0.1));
      const { samples } = useSysinfoStore.getState();
      expect(samples).toHaveLength(1);
      expect(samples[0]!.t).toBe(1);
    });

    test("floating-point jitter below 3-decimal rounding is ignored", () => {
      useSysinfoStore.getState().ingest(sample(1, 0.4321));
      useSysinfoStore.getState().ingest(sample(2, 0.4323));
      expect(useSysinfoStore.getState().samples).toHaveLength(1);
    });

    test("cpu change beyond rounding precision is accepted", () => {
      useSysinfoStore.getState().ingest(sample(1, 0.432));
      useSysinfoStore.getState().ingest(sample(2, 0.433));
      const { samples } = useSysinfoStore.getState();
      expect(samples).toHaveLength(2);
      expect(samples[1]!.cpu).toBeCloseTo(0.433, 5);
    });

    test("load1 drift within ±0.005 is ignored; beyond is accepted", () => {
      const base: SystemStatsSample = {
        t: 1,
        cpu: 0.1,
        mem: 0.5,
        load1: 1,
        cores: 4,
        uptimeSec: 60
      };
      useSysinfoStore.getState().ingest(base);
      useSysinfoStore.getState().ingest({ ...base, t: 2, load1: 1.003 });
      expect(useSysinfoStore.getState().samples).toHaveLength(1);
      useSysinfoStore.getState().ingest({ ...base, t: 3, load1: 1.01 });
      expect(useSysinfoStore.getState().samples).toHaveLength(2);
    });

    test("core count change forces acceptance (hotplug etc.)", () => {
      useSysinfoStore.getState().ingest(sample(1));
      useSysinfoStore
        .getState()
        .ingest({ t: 2, cpu: 0.1, mem: 0.5, load1: 1, cores: 8, uptimeSec: 62 });
      expect(useSysinfoStore.getState().samples).toHaveLength(2);
    });

    test("ingest after markUnsupported bypasses dedup to seed history", () => {
      useSysinfoStore.getState().ingest(sample(1));
      useSysinfoStore.getState().markUnsupported();
      useSysinfoStore.getState().ingest(sample(2));
      const { samples, supported } = useSysinfoStore.getState();
      expect(supported).toBe(true);
      expect(samples).toHaveLength(1);
      expect(samples[0]!.t).toBe(2);
    });
  });
});

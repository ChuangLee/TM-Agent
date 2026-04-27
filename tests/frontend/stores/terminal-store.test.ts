// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import {
  selectSlotSeed,
  selectSlotSwitchPending,
  useTerminalStore
} from "../../../src/frontend/stores/terminal-store.js";

const reset = (): void => {
  useTerminalStore.setState({
    slots: {
      0: { seed: null, sessionSwitchPending: false },
      1: { seed: null, sessionSwitchPending: false },
      2: { seed: null, sessionSwitchPending: false },
      3: { seed: null, sessionSwitchPending: false }
    }
  });
};

describe("terminal-store (per-slot)", () => {
  beforeEach(reset);

  test("setSeed writes to the named slot only", () => {
    useTerminalStore.getState().setSeed(0, "%1", "hello");
    const state = useTerminalStore.getState();
    expect(state.slots[0].seed).toMatchObject({
      paneId: "%1",
      text: "hello"
    });
    expect(state.slots[1].seed).toBeNull();
    expect(state.slots[2].seed).toBeNull();
    expect(state.slots[3].seed).toBeNull();
  });

  test("setSeed on different slots stays isolated", () => {
    useTerminalStore.getState().setSeed(0, "%1", "alpha");
    useTerminalStore.getState().setSeed(2, "%2", "gamma");

    const state = useTerminalStore.getState();
    expect(state.slots[0].seed?.text).toBe("alpha");
    expect(state.slots[1].seed).toBeNull();
    expect(state.slots[2].seed?.text).toBe("gamma");
    expect(state.slots[3].seed).toBeNull();
  });

  test("clearSeed clears just the named slot", () => {
    useTerminalStore.getState().setSeed(0, "%1", "alpha");
    useTerminalStore.getState().setSeed(1, "%2", "beta");
    useTerminalStore.getState().clearSeed(0);

    const state = useTerminalStore.getState();
    expect(state.slots[0].seed).toBeNull();
    expect(state.slots[1].seed?.text).toBe("beta");
  });

  test("beginSessionSwitch / endSessionSwitch toggle per slot", () => {
    useTerminalStore.getState().beginSessionSwitch(2);
    let state = useTerminalStore.getState();
    expect(state.slots[2].sessionSwitchPending).toBe(true);
    expect(state.slots[0].sessionSwitchPending).toBe(false);

    useTerminalStore.getState().endSessionSwitch(2);
    state = useTerminalStore.getState();
    expect(state.slots[2].sessionSwitchPending).toBe(false);
  });

  test("selectSlotSeed selector returns the slot's seed", () => {
    useTerminalStore.getState().setSeed(3, "%9", "delta");
    const state = useTerminalStore.getState();
    expect(selectSlotSeed(3)(state)?.text).toBe("delta");
    expect(selectSlotSeed(0)(state)).toBeNull();
  });

  test("selectSlotSwitchPending selector returns the slot's flag", () => {
    useTerminalStore.getState().beginSessionSwitch(1);
    const state = useTerminalStore.getState();
    expect(selectSlotSwitchPending(1)(state)).toBe(true);
    expect(selectSlotSwitchPending(0)(state)).toBe(false);
  });

  test("subscribe fires for all slots; consumer must filter by slot", () => {
    let myFlag = useTerminalStore.getState().slots[1].sessionSwitchPending;
    const events: boolean[] = [];
    const unsub = useTerminalStore.subscribe((state) => {
      const next = state.slots[1].sessionSwitchPending;
      if (next !== myFlag) {
        events.push(next);
        myFlag = next;
      }
    });

    useTerminalStore.getState().beginSessionSwitch(0); // not slot 1 → no event
    useTerminalStore.getState().beginSessionSwitch(1); // slot 1 → event
    useTerminalStore.getState().endSessionSwitch(1); // slot 1 → event

    unsub();
    expect(events).toEqual([true, false]);
  });
});

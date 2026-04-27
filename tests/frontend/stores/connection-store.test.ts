import { describe, expect, test, beforeEach } from "vitest";
import { useConnectionStore } from "../../../src/frontend/stores/connection-store.js";

describe("connection-store", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      status: { kind: "idle" },
      reconnectTick: 0
    });
  });

  test("setStatus replaces the current transport status", () => {
    useConnectionStore.getState().setStatus({ kind: "connecting" });
    expect(useConnectionStore.getState().status).toEqual({ kind: "connecting" });

    useConnectionStore.getState().setStatus({ kind: "open" });
    expect(useConnectionStore.getState().status).toEqual({ kind: "open" });

    useConnectionStore.getState().setStatus({
      kind: "closed",
      code: 1006,
      reason: "abnormal"
    });
    expect(useConnectionStore.getState().status).toEqual({
      kind: "closed",
      code: 1006,
      reason: "abnormal"
    });
  });

  test("reconnect() bumps the tick so subscribers can re-run effects", () => {
    expect(useConnectionStore.getState().reconnectTick).toBe(0);
    useConnectionStore.getState().reconnect();
    expect(useConnectionStore.getState().reconnectTick).toBe(1);
    useConnectionStore.getState().reconnect();
    expect(useConnectionStore.getState().reconnectTick).toBe(2);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useComposeBridge } from "../../../src/frontend/features/compose/compose-bridge.js";

describe("compose-bridge", () => {
  beforeEach(() => {
    useComposeBridge.setState({ focusCallback: null });
  });

  test("focus is a no-op when no callback is registered", () => {
    expect(() => useComposeBridge.getState().focus()).not.toThrow();
    expect(() => useComposeBridge.getState().focus("hello")).not.toThrow();
  });

  test("registered callback is invoked with prefill", () => {
    const cb = vi.fn();
    const unregister = useComposeBridge.getState().register(cb);
    useComposeBridge.getState().focus("git commit -m ");
    expect(cb).toHaveBeenCalledWith("git commit -m ");
    unregister();
  });

  test("unregister removes the callback", () => {
    const cb = vi.fn();
    const unregister = useComposeBridge.getState().register(cb);
    unregister();
    useComposeBridge.getState().focus("x");
    expect(cb).not.toHaveBeenCalled();
  });

  test("register overwrites previous callback (only one ComposeBar at a time)", () => {
    const first = vi.fn();
    const second = vi.fn();
    useComposeBridge.getState().register(first);
    useComposeBridge.getState().register(second);
    useComposeBridge.getState().focus("ping");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("ping");
  });
});

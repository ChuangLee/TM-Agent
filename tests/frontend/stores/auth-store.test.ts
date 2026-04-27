// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

const resetAuthModule = async (): Promise<
  typeof import("../../../src/frontend/stores/auth-store.js")
> => {
  vi.resetModules();
  return import("../../../src/frontend/stores/auth-store.js");
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("useAuthStore", () => {
  test("persists password so the same browser does not prompt again", async () => {
    const { useAuthStore } = await resetAuthModule();

    useAuthStore.getState().setPassword("secret");

    expect(useAuthStore.getState().password).toBe("secret");
    expect(window.localStorage.getItem("tm-agent-password")).toBe("secret");
  });

  test("loads persisted password on startup", async () => {
    window.localStorage.setItem("tm-agent-password", "saved-secret");

    const { useAuthStore } = await resetAuthModule();

    expect(useAuthStore.getState().password).toBe("saved-secret");
  });

  test("migrates the old agent-tmux password key", async () => {
    window.localStorage.setItem("agent-tmux-password", "old-secret");

    const { useAuthStore } = await resetAuthModule();

    expect(useAuthStore.getState().password).toBe("old-secret");
    expect(window.localStorage.getItem("tm-agent-password")).toBe("old-secret");
    expect(window.localStorage.getItem("agent-tmux-password")).toBeNull();
  });

  test("empty password clears persisted values", async () => {
    window.localStorage.setItem("tm-agent-password", "saved-secret");
    window.localStorage.setItem("agent-tmux-password", "old-secret");
    const { useAuthStore } = await resetAuthModule();

    useAuthStore.getState().setPassword("");

    expect(useAuthStore.getState().password).toBe("");
    expect(window.localStorage.getItem("tm-agent-password")).toBeNull();
    expect(window.localStorage.getItem("agent-tmux-password")).toBeNull();
  });
});

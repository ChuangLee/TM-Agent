// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { useAuthStore } from "../../../src/frontend/stores/auth-store.js";

beforeEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({
    token: "",
    password: "",
    passwordRequired: false,
    phase: "probing",
    errorMessage: "",
    clientId: ""
  });
});

describe("useAuthStore", () => {
  test("keeps password in memory only", () => {
    useAuthStore.getState().setPassword("secret");
    expect(useAuthStore.getState().password).toBe("secret");
    expect(window.localStorage.getItem("tm-agent-password")).toBeNull();
  });

  test("clears legacy persisted password when password changes", () => {
    window.localStorage.setItem("tm-agent-password", "old-secret");
    useAuthStore.getState().setPassword("new-secret");
    expect(window.localStorage.getItem("tm-agent-password")).toBeNull();
  });
});

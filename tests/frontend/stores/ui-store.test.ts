// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { useUiStore } from "../../../src/frontend/stores/ui-store.js";

describe("ui-store — sidebar collapse", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ sidebarCollapsed: false });
  });

  test("toggleSidebar flips the boolean and persists to localStorage", () => {
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(localStorage.getItem("tm-agent:sidebarCollapsed")).toBe("1");

    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    expect(localStorage.getItem("tm-agent:sidebarCollapsed")).toBe("0");
  });

  test("setSidebarCollapsed writes explicit value without toggling", () => {
    useUiStore.getState().setSidebarCollapsed(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(localStorage.getItem("tm-agent:sidebarCollapsed")).toBe("1");

    useUiStore.getState().setSidebarCollapsed(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  test("keyboardInset updates independently of sidebar state", () => {
    useUiStore.getState().setKeyboardInset(200);
    expect(useUiStore.getState().keyboardInset).toBe(200);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });
});

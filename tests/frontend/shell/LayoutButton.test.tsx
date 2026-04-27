// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LayoutButton } from "../../../src/frontend/features/shell/LayoutButton.js";
import { useLayoutStore } from "../../../src/frontend/stores/layout-store.js";

beforeEach(() => {
  localStorage.clear();
  useLayoutStore.setState({
    mode: 1,
    slots: [{ id: 0, attachedSession: null }],
    focusedSlot: 0
  });
});

afterEach(cleanup);

describe("LayoutButton", () => {
  test("renders the current mode glyph", () => {
    render(<LayoutButton />);
    const btn = screen.getByTestId("topbar-layout");
    expect(btn.getAttribute("data-layout-mode")).toBe("1");
    expect(btn.textContent ?? "").toContain("▢");
  });

  test("toggling reveals the menu with three options", () => {
    render(<LayoutButton />);
    fireEvent.click(screen.getByTestId("topbar-layout"));
    expect(screen.getByTestId("topbar-layout-menu")).toBeTruthy();
    expect(screen.getByTestId("topbar-layout-opt-1")).toBeTruthy();
    expect(screen.getByTestId("topbar-layout-opt-2")).toBeTruthy();
    expect(screen.getByTestId("topbar-layout-opt-4")).toBeTruthy();
  });

  test("Single is enabled and marked checked when active", () => {
    render(<LayoutButton />);
    fireEvent.click(screen.getByTestId("topbar-layout"));
    const single = screen.getByTestId("topbar-layout-opt-1");
    expect(single.getAttribute("aria-checked")).toBe("true");
    expect(single.getAttribute("data-disabled")).toBe("false");
  });

  test("all options enabled when no slot is attached", () => {
    render(<LayoutButton />);
    fireEvent.click(screen.getByTestId("topbar-layout"));
    expect(screen.getByTestId("topbar-layout-opt-1").getAttribute("data-disabled")).toBe("false");
    expect(screen.getByTestId("topbar-layout-opt-2").getAttribute("data-disabled")).toBe("false");
    expect(screen.getByTestId("topbar-layout-opt-4").getAttribute("data-disabled")).toBe("false");
  });

  test("Single is disabled when 2 sessions are attached (would orphan one)", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "alpha" },
        { id: 1, attachedSession: "beta" }
      ],
      focusedSlot: 0
    });
    render(<LayoutButton />);
    fireEvent.click(screen.getByTestId("topbar-layout"));
    const single = screen.getByTestId("topbar-layout-opt-1");
    expect(single.getAttribute("data-disabled")).toBe("true");
    expect(single.getAttribute("title") ?? "").toMatch(/Close excess|关闭多余/);
  });

  test("clicking a disabled option does not change mode and keeps menu open", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "alpha" },
        { id: 1, attachedSession: "beta" }
      ],
      focusedSlot: 0
    });
    render(<LayoutButton />);
    fireEvent.click(screen.getByTestId("topbar-layout"));
    fireEvent.click(screen.getByTestId("topbar-layout-opt-1"));
    expect(useLayoutStore.getState().mode).toBe(2);
    // Menu still open because disabled click is a no-op.
    expect(screen.queryByTestId("topbar-layout-menu")).not.toBeNull();
  });

  test("switching to enabled mode persists and closes menu", () => {
    render(<LayoutButton />);
    fireEvent.click(screen.getByTestId("topbar-layout"));
    fireEvent.click(screen.getByTestId("topbar-layout-opt-2"));
    expect(useLayoutStore.getState().mode).toBe(2);
    expect(screen.queryByTestId("topbar-layout-menu")).toBeNull();
  });

  test("clicking the active option closes the menu without state change", () => {
    render(<LayoutButton />);
    fireEvent.click(screen.getByTestId("topbar-layout"));
    fireEvent.click(screen.getByTestId("topbar-layout-opt-1"));
    expect(useLayoutStore.getState().mode).toBe(1);
    expect(screen.queryByTestId("topbar-layout-menu")).toBeNull();
  });

  test("Escape closes the menu", () => {
    render(<LayoutButton />);
    fireEvent.click(screen.getByTestId("topbar-layout"));
    expect(screen.queryByTestId("topbar-layout-menu")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("topbar-layout-menu")).toBeNull();
  });

  test("clicking outside the root closes the menu", () => {
    render(
      <div>
        <LayoutButton />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByTestId("topbar-layout"));
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("topbar-layout-menu")).toBeNull();
  });
});

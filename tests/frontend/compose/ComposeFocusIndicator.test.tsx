// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ComposeFocusIndicator } from "../../../src/frontend/features/compose/ComposeFocusIndicator.js";
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

describe("ComposeFocusIndicator", () => {
  test("returns null in single-mode (no ambiguity)", () => {
    const { container } = render(<ComposeFocusIndicator />);
    expect(container.firstChild).toBeNull();
  });

  test("renders with focused slot's session in multi-mode", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "alpha" },
        { id: 1, attachedSession: "beta" }
      ],
      focusedSlot: 1
    });
    render(<ComposeFocusIndicator />);
    const indicator = screen.getByTestId("compose-focus-indicator");
    expect(indicator.getAttribute("data-slot")).toBe("1");
    expect(screen.getByTestId("compose-focus-label").textContent).toContain("→ beta");
  });

  test("shows '(empty slot)' when focused slot is empty", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "alpha" },
        { id: 1, attachedSession: null }
      ],
      focusedSlot: 1
    });
    render(<ComposeFocusIndicator />);
    expect(screen.getByTestId("compose-focus-label").textContent).toContain("empty slot");
  });
});

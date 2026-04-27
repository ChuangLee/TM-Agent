// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WindowStrip } from "../../../src/frontend/features/sessions/WindowStrip.js";
import { useSessionsStore } from "../../../src/frontend/stores/sessions-store.js";
import { useSheetStore } from "../../../src/frontend/stores/sheet-store.js";

const makeSnapshot = (windows: number) => ({
  capturedAt: "2026-04-22T00:00:00Z",
  sessions: [
    {
      name: "main",
      attached: true,
      windows,
      windowStates: Array.from({ length: windows }, (_, i) => ({
        index: i,
        name: `w${i}`,
        active: i === 0,
        paneCount: 1,
        panes: []
      }))
    }
  ]
});

beforeEach(() => {
  useSheetStore.setState({ active: { kind: "none" } });
});

afterEach(() => {
  cleanup();
});

describe("<WindowStrip />", () => {
  test("renders null when the attached session has ≤ 1 window", () => {
    useSessionsStore.setState({
      snapshot: makeSnapshot(1),
      attachedSession: "tm-agent-client-abc",
      attachedBaseSession: "main"
    });
    const { container } = render(<WindowStrip onSelect={() => {}} onNewWindow={() => {}} />);
    expect(container.querySelector("[data-testid='window-strip']")).toBeNull();
  });

  test("renders one chip per window + a + button", () => {
    useSessionsStore.setState({
      snapshot: makeSnapshot(3),
      attachedSession: "tm-agent-client-abc",
      attachedBaseSession: "main"
    });
    render(<WindowStrip onSelect={() => {}} onNewWindow={() => {}} />);
    const chips = screen.getAllByTestId("window-chip");
    expect(chips.length).toBe(3);
    expect(chips[0]?.getAttribute("data-active")).toBe("true");
    expect(chips[1]?.getAttribute("data-active")).toBeNull();
    expect(screen.getByTestId("window-new")).toBeTruthy();
  });

  test("chip click fires onSelect with window index", () => {
    useSessionsStore.setState({
      snapshot: makeSnapshot(3),
      attachedSession: "tm-agent-client-abc",
      attachedBaseSession: "main"
    });
    const onSelect = vi.fn();
    render(<WindowStrip onSelect={onSelect} onNewWindow={() => {}} />);
    fireEvent.click(screen.getAllByTestId("window-chip")[2]!);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  test("⋯ button opens window-actions sheet with the right target", () => {
    useSessionsStore.setState({
      snapshot: makeSnapshot(3),
      attachedSession: "tm-agent-client-abc",
      attachedBaseSession: "main"
    });
    render(<WindowStrip onSelect={() => {}} onNewWindow={() => {}} />);
    fireEvent.click(screen.getAllByTestId("window-chip-menu")[1]!);
    expect(useSheetStore.getState().active).toEqual({
      kind: "window-actions",
      session: "main",
      windowIndex: 1,
      windowName: "w1"
    });
  });

  test("+ button fires onNewWindow", () => {
    useSessionsStore.setState({
      snapshot: makeSnapshot(2),
      attachedSession: "tm-agent-client-abc",
      attachedBaseSession: "main"
    });
    const onNewWindow = vi.fn();
    render(<WindowStrip onSelect={() => {}} onNewWindow={onNewWindow} />);
    fireEvent.click(screen.getByTestId("window-new"));
    expect(onNewWindow).toHaveBeenCalledOnce();
  });
});

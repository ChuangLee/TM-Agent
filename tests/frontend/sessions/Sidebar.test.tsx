// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "../../../src/frontend/features/sessions/Sidebar.js";
import { useSessionsStore } from "../../../src/frontend/stores/sessions-store.js";
import { useUiStore } from "../../../src/frontend/stores/ui-store.js";
import { useConnectionStore } from "../../../src/frontend/stores/connection-store.js";

const snapshot = {
  capturedAt: "2026-04-22T00:00:00Z",
  sessions: [
    {
      name: "main",
      attached: true,
      windows: 2,
      windowStates: [
        { index: 0, name: "shell", active: true, paneCount: 1, panes: [] },
        { index: 1, name: "vim", active: false, paneCount: 1, panes: [] }
      ]
    },
    {
      name: "work",
      attached: false,
      windows: 1,
      windowStates: [{ index: 0, name: "dev", active: true, paneCount: 1, panes: [] }]
    },
    {
      name: "tm-agent-client-abc",
      attached: false,
      windows: 1,
      windowStates: []
    },
    {
      name: "agent-tmux-client-legacy",
      attached: false,
      windows: 1,
      windowStates: []
    }
  ]
};

beforeEach(() => {
  localStorage.clear();
  useSessionsStore.setState({
    snapshot,
    attachedSession: "tm-agent-client-abc",
    attachedBaseSession: "main"
  });
  useConnectionStore.setState({
    status: { kind: "open" },
    reconnectTick: 0
  });
  useUiStore.setState({ sidebarCollapsed: false });
});

afterEach(() => {
  cleanup();
});

describe("<Sidebar />", () => {
  test("expanded: renders header with attached session name + SessionList items", () => {
    render(<Sidebar onSelect={() => {}} />);
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    expect(screen.getByTestId("sidebar-attached-name").textContent).toBe("main");

    const items = screen.getAllByTestId("session-list-item");
    expect(items.length).toBe(2); // main + work, managed client sessions hidden
    expect(items[0]?.getAttribute("data-session")).toBe("main");
    expect(items[0]?.getAttribute("aria-current")).toBe("true");
  });

  test("collapsed: renders the rail instead of the header", () => {
    useUiStore.setState({ sidebarCollapsed: true });
    render(<Sidebar onSelect={() => {}} />);
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(screen.getByTestId("session-rail")).toBeTruthy();

    const railItems = screen.getAllByTestId("session-rail-item");
    expect(railItems.length).toBe(2);
    expect(railItems[0]?.getAttribute("data-session")).toBe("main");
    expect(railItems[0]?.getAttribute("aria-current")).toBe("true");
    expect(railItems[0]?.textContent).toBe("MA");
  });

  test("collapse button toggles the store", () => {
    render(<Sidebar onSelect={() => {}} />);
    const btn = screen.getByRole("button", { name: /collapse sidebar/i });
    fireEvent.click(btn);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  test("expand button on the rail toggles back", () => {
    useUiStore.setState({ sidebarCollapsed: true });
    render(<Sidebar onSelect={() => {}} />);
    const btn = screen.getByRole("button", { name: /expand sidebar/i });
    fireEvent.click(btn);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  test("clicking a session item fires onSelect with the session name", () => {
    const onSelect = vi.fn();
    render(<Sidebar onSelect={onSelect} />);
    const work = screen
      .getAllByTestId("session-list-item")
      .find((el) => el.getAttribute("data-session") === "work");
    expect(work).toBeDefined();
    fireEvent.click(work!);
    expect(onSelect).toHaveBeenCalledWith("work");
  });

  test("collapsed rail: clicking a session initial fires onSelect", () => {
    useUiStore.setState({ sidebarCollapsed: true });
    const onSelect = vi.fn();
    render(<Sidebar onSelect={onSelect} />);
    const work = screen
      .getAllByTestId("session-rail-item")
      .find((el) => el.getAttribute("data-session") === "work");
    fireEvent.click(work!);
    expect(onSelect).toHaveBeenCalledWith("work");
  });

  test("expanded sidebar stacks Sessions above Files (no tab switcher)", () => {
    render(<Sidebar onSelect={() => {}} />);
    // Both sections are mounted at once.
    expect(screen.getByTestId("sidebar-sessions")).toBeTruthy();
    expect(screen.getByTestId("sidebar-files")).toBeTruthy();
    // The old tab strip is gone.
    expect(screen.queryByTestId("sidebar-tabs")).toBeNull();
    // Files section sits visually below Sessions in DOM order.
    const sessions = screen.getByTestId("sidebar-sessions");
    const files = screen.getByTestId("sidebar-files");
    expect(sessions.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("scroll fade indicator shows only when the sessions list overflows", () => {
    // No overflow at mount (jsdom clientHeight === scrollHeight by default).
    render(<Sidebar onSelect={() => {}} />);
    expect(screen.queryByTestId("sessions-scroll-fade-bottom")).toBeNull();

    // Force overflow via the scroll container's layout, then dispatch a
    // synthetic scroll event to trigger the update handler.
    const scroller = screen
      .getByTestId("sidebar-sessions")
      .querySelector(".overflow-y-auto") as HTMLDivElement;
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 500
    });
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 220
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0
    });
    fireEvent.scroll(scroller);
    expect(screen.getByTestId("sessions-scroll-fade-bottom")).toBeTruthy();
    expect(screen.queryByTestId("sessions-scroll-fade-top")).toBeNull();

    // After scrolling down, the top fade appears too.
    (scroller as unknown as { scrollTop: number }).scrollTop = 50;
    fireEvent.scroll(scroller);
    expect(screen.getByTestId("sessions-scroll-fade-top")).toBeTruthy();
  });
});

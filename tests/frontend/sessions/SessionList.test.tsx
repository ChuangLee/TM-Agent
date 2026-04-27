// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionList } from "../../../src/frontend/features/sessions/SessionList.js";
import { useSessionsStore } from "../../../src/frontend/stores/sessions-store.js";
import { useSheetStore } from "../../../src/frontend/stores/sheet-store.js";

beforeEach(() => {
  useSheetStore.setState({ active: { kind: "none" } });
});

afterEach(() => {
  cleanup();
});

describe("<SessionList /> — loading + empty states", () => {
  test("renders a skeleton while the snapshot is null", () => {
    useSessionsStore.setState({
      snapshot: null,
      attachedBaseSession: "",
      attachedSession: ""
    });
    render(<SessionList onSelect={() => {}} />);
    expect(screen.getByTestId("session-list-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("session-list")).toBeNull();
    expect(screen.queryByTestId("session-list-empty")).toBeNull();
  });

  test("renders the empty-state copy when the snapshot has no user sessions", () => {
    useSessionsStore.setState({
      snapshot: {
        capturedAt: "2026-04-22T00:00:00Z",
        sessions: [
          {
            name: "tm-agent-client-abc",
            attached: false,
            windows: 1,
            windowStates: []
          }
        ]
      },
      attachedBaseSession: "",
      attachedSession: "tm-agent-client-abc"
    });
    render(<SessionList onSelect={() => {}} />);
    const empty = screen.getByTestId("session-list-empty");
    expect(empty.textContent).toMatch(/No sessions yet/i);
    // Empty state still offers the "New session" entry point so users can
    // bootstrap without touching the shell.
    expect(screen.getByTestId("session-list-new")).toBeTruthy();
  });

  test("renders session rows with relative last-seen when present", () => {
    useSessionsStore.setState({
      snapshot: {
        capturedAt: "2026-04-22T00:00:00Z",
        sessions: [
          {
            name: "main",
            attached: true,
            windows: 1,
            lastActivity: Math.floor(Date.now() / 1000) - 120,
            windowStates: [{ index: 0, name: "shell", active: true, paneCount: 1, panes: [] }]
          }
        ]
      },
      attachedBaseSession: "main",
      attachedSession: "tm-agent-client-abc"
    });
    render(<SessionList onSelect={() => {}} />);
    const row = screen.getByTestId("session-list-item");
    expect(row.textContent).toContain("main");
    expect(row.textContent).toMatch(/\d+m/); // "2m" approximately
  });

  test("+ New session button opens the new-session sheet", () => {
    useSessionsStore.setState({
      snapshot: {
        capturedAt: "2026-04-22T00:00:00Z",
        sessions: [
          {
            name: "main",
            attached: true,
            windows: 1,
            windowStates: [{ index: 0, name: "shell", active: true, paneCount: 1, panes: [] }]
          }
        ]
      },
      attachedBaseSession: "main",
      attachedSession: "tm-agent-client-abc"
    });
    render(<SessionList onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId("session-list-new"));
    expect(useSheetStore.getState().active).toEqual({ kind: "new-session" });
  });
});

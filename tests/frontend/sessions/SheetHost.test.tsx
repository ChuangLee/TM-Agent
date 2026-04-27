// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SheetHost } from "../../../src/frontend/features/sessions/SheetHost.js";
import { useSheetStore } from "../../../src/frontend/stores/sheet-store.js";
import { useSessionsStore } from "../../../src/frontend/stores/sessions-store.js";

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
    }
  ]
};

beforeEach(() => {
  useSheetStore.setState({ active: { kind: "none" } });
  useSessionsStore.setState({
    snapshot,
    attachedSession: "tm-agent-client-abc",
    attachedBaseSession: "main"
  });
});

afterEach(() => {
  cleanup();
});

describe("<SheetHost />", () => {
  test("session-actions → Rename opens the rename-session sheet", () => {
    const send = vi.fn();
    useSheetStore.setState({
      active: { kind: "session-actions", session: "main" }
    });
    render(<SheetHost send={send} />);

    fireEvent.click(screen.getByTestId("session-action-rename"));
    expect(useSheetStore.getState().active).toEqual({
      kind: "rename-session",
      session: "main"
    });
  });

  test("session-actions → Kill requires two taps (arm + confirm)", () => {
    const send = vi.fn();
    useSheetStore.setState({
      active: { kind: "session-actions", session: "main" }
    });
    render(<SheetHost send={send} />);

    const kill = screen.getByTestId("session-action-kill");
    fireEvent.click(kill);
    expect(send).not.toHaveBeenCalled();
    expect(kill.getAttribute("data-armed")).toBe("true");

    fireEvent.click(kill);
    expect(send).toHaveBeenCalledWith({
      type: "kill_session",
      session: "main"
    });
  });

  test("rename-session submit sends rename_session and closes", () => {
    const send = vi.fn();
    useSheetStore.setState({
      active: { kind: "rename-session", session: "main" }
    });
    render(<SheetHost send={send} />);

    const input = screen.getByTestId("rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "work" } });
    fireEvent.click(screen.getByTestId("rename-submit"));

    expect(send).toHaveBeenCalledWith({
      type: "rename_session",
      session: "main",
      newName: "work"
    });
    expect(useSheetStore.getState().active.kind).toBe("none");
  });

  test("rename-session blocks submit when name is unchanged or empty", () => {
    const send = vi.fn();
    useSheetStore.setState({
      active: { kind: "rename-session", session: "main" }
    });
    render(<SheetHost send={send} />);

    const submit = screen.getByTestId("rename-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const input = screen.getByTestId("rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "work" } });
    expect(submit.disabled).toBe(false);
  });

  test("window-actions → Kill on last window is a no-op (guard)", () => {
    const send = vi.fn();
    const singleWindow = {
      ...snapshot,
      sessions: [
        {
          ...snapshot.sessions[0],
          windows: 1,
          windowStates: [snapshot.sessions[0].windowStates[0]]
        }
      ]
    };
    useSessionsStore.setState({ snapshot: singleWindow });
    useSheetStore.setState({
      active: {
        kind: "window-actions",
        session: "main",
        windowIndex: 0,
        windowName: "shell"
      }
    });
    render(<SheetHost send={send} />);

    const kill = screen.getByTestId("window-action-kill");
    fireEvent.click(kill);
    fireEvent.click(kill);
    expect(send).not.toHaveBeenCalled();
  });

  test("window-actions → Kill on multi-window session sends kill_window after arm", () => {
    const send = vi.fn();
    useSheetStore.setState({
      active: {
        kind: "window-actions",
        session: "main",
        windowIndex: 1,
        windowName: "vim"
      }
    });
    render(<SheetHost send={send} />);

    const kill = screen.getByTestId("window-action-kill");
    fireEvent.click(kill);
    fireEvent.click(kill);
    expect(send).toHaveBeenCalledWith({
      type: "kill_window",
      session: "main",
      windowIndex: 1
    });
  });

  test("rename-window submit sends rename_window", () => {
    const send = vi.fn();
    useSheetStore.setState({
      active: {
        kind: "rename-window",
        session: "main",
        windowIndex: 1,
        currentName: "vim"
      }
    });
    render(<SheetHost send={send} />);

    const input = screen.getByTestId("rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "editor" } });
    fireEvent.click(screen.getByTestId("rename-submit"));

    expect(send).toHaveBeenCalledWith({
      type: "rename_window",
      session: "main",
      windowIndex: 1,
      newName: "editor"
    });
  });

  test("new-session sheet dispatches new_session with the typed name", () => {
    const send = vi.fn();
    useSheetStore.setState({ active: { kind: "new-session" } });
    render(<SheetHost send={send} />);
    const input = screen.getByTestId("new-session-name") as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "scratch" } });
    fireEvent.click(screen.getByTestId("new-session-submit"));
    // Default form: cwd "~" (sent so backend expands to $HOME), no startup cmd.
    expect(send).toHaveBeenCalledWith({
      type: "new_session",
      name: "scratch",
      cwd: "~"
    });
    expect(useSheetStore.getState().active).toEqual({ kind: "none" });
  });

  test("new-session submit is disabled until the user types a name", () => {
    const send = vi.fn();
    useSheetStore.setState({ active: { kind: "new-session" } });
    render(<SheetHost send={send} />);
    const submit = screen.getByTestId("new-session-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const input = screen.getByTestId("new-session-name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  " } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "work" } });
    expect(submit.disabled).toBe(false);
  });

  test("new-session sheet forwards cwd + startup command with safe preset flags", () => {
    const send = vi.fn();
    useSheetStore.setState({ active: { kind: "new-session" } });
    render(<SheetHost send={send} />);
    fireEvent.change(screen.getByTestId("new-session-name"), {
      target: { value: "agent" }
    });
    fireEvent.change(screen.getByTestId("new-session-cwd"), {
      target: { value: "/root/repos/TM-Agent" }
    });
    fireEvent.click(screen.getByTestId("new-session-cmd-claude"));
    fireEvent.click(screen.getByTestId("new-session-flag---resume"));
    fireEvent.click(screen.getByTestId("new-session-submit"));
    expect(send).toHaveBeenCalledWith({
      type: "new_session",
      name: "agent",
      cwd: "/root/repos/TM-Agent",
      startupCommand: "claude --resume"
    });
  });
});

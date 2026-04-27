// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

// Stub Surface so we don't pull in xterm + terminal-ws plumbing in unit tests.
// Each stub records its onReady so tests can simulate the "first measurement"
// signal (otherwise SlotFrame's effect never dispatches select_session).
vi.mock("../../../src/frontend/features/terminal/Surface.js", () => ({
  Surface: ({
    slotId,
    onReady
  }: {
    slotId?: number;
    onReady?: (cols: number, rows: number) => void;
  }): ReactElement => {
    return (
      <div data-testid={`surface-stub-${slotId ?? 0}`}>
        <button
          type="button"
          data-testid={`surface-stub-${slotId ?? 0}-ready`}
          onClick={() => onReady?.(80, 24)}
        >
          fire ready
        </button>
      </div>
    );
  }
}));

import { MultiSurface } from "../../../src/frontend/features/terminal/MultiSurface.js";
import { useLayoutStore } from "../../../src/frontend/stores/layout-store.js";
import { useSessionsStore } from "../../../src/frontend/stores/sessions-store.js";
import { useSheetStore } from "../../../src/frontend/stores/sheet-store.js";
import { useTerminalStore } from "../../../src/frontend/stores/terminal-store.js";
import type { ControlClientMessage } from "../../../src/shared/protocol.js";

const sessionsSnapshot = {
  capturedAt: "2026-04-22T00:00:00Z",
  sessions: [
    {
      name: "main",
      attached: true,
      windows: 1,
      windowStates: [{ index: 0, name: "shell", active: true, paneCount: 1, panes: [] }]
    },
    {
      name: "work",
      attached: false,
      windows: 1,
      windowStates: [{ index: 0, name: "dev", active: true, paneCount: 1, panes: [] }]
    }
  ]
};

const reset = (): void => {
  localStorage.clear();
  useSessionsStore.setState({ snapshot: sessionsSnapshot });
  useTerminalStore.setState({
    slots: {
      0: { seed: null, sessionSwitchPending: false },
      1: { seed: null, sessionSwitchPending: false },
      2: { seed: null, sessionSwitchPending: false },
      3: { seed: null, sessionSwitchPending: false }
    }
  });
  useLayoutStore.setState({
    mode: 1,
    slots: [{ id: 0, attachedSession: null }],
    focusedSlot: 0
  });
};

beforeEach(reset);
afterEach(cleanup);

describe("MultiSurface — layout shape", () => {
  test("single mode renders 1 SlotFrame, no mini-bar", () => {
    render(<MultiSurface send={vi.fn()} />);
    expect(screen.getByTestId("multi-surface-single")).toBeTruthy();
    expect(screen.getByTestId("slot-frame-0")).toBeTruthy();
    expect(screen.queryByTestId("slot-frame-1")).toBeNull();
    // Single mode: no mini-bar even on slot 0.
    expect(screen.queryByTestId("slot-frame-0-close")).toBeNull();
  });

  test("2-cols mode renders SlotFrame for slots 0 and 1", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: null }
      ],
      focusedSlot: 0
    });
    render(<MultiSurface send={vi.fn()} />);
    expect(screen.getByTestId("multi-surface-2cols")).toBeTruthy();
    expect(screen.getByTestId("slot-frame-0")).toBeTruthy();
    expect(screen.getByTestId("slot-frame-1")).toBeTruthy();
    expect(screen.queryByTestId("slot-frame-2")).toBeNull();
  });

  test("Quad (2×2) mode renders all four SlotFrames", () => {
    useLayoutStore.setState({
      mode: 4,
      slots: [
        { id: 0, attachedSession: null },
        { id: 1, attachedSession: null },
        { id: 2, attachedSession: null },
        { id: 3, attachedSession: null }
      ],
      focusedSlot: 0
    });
    render(<MultiSurface send={vi.fn()} />);
    expect(screen.getByTestId("multi-surface-quad")).toBeTruthy();
    expect(screen.getByTestId("slot-frame-0")).toBeTruthy();
    expect(screen.getByTestId("slot-frame-1")).toBeTruthy();
    expect(screen.getByTestId("slot-frame-2")).toBeTruthy();
    expect(screen.getByTestId("slot-frame-3")).toBeTruthy();
  });
});

describe("SlotFrame — focus + close", () => {
  test("clicking a slot updates focusedSlot in layout-store", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: "work" }
      ],
      focusedSlot: 0
    });
    render(<MultiSurface send={vi.fn()} />);
    expect(useLayoutStore.getState().focusedSlot).toBe(0);
    fireEvent.click(screen.getByTestId("slot-frame-1"));
    expect(useLayoutStore.getState().focusedSlot).toBe(1);
  });

  test("focused slot has data-focused=true; others false", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: "work" }
      ],
      focusedSlot: 1
    });
    render(<MultiSurface send={vi.fn()} />);
    expect(screen.getByTestId("slot-frame-0").getAttribute("data-focused")).toBe("false");
    expect(screen.getByTestId("slot-frame-1").getAttribute("data-focused")).toBe("true");
  });

  test("close button dispatches detach_slot + auto-collapses to single", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: "work" }
      ],
      focusedSlot: 0
    });
    const sent: ControlClientMessage[] = [];
    const send = vi.fn((m: ControlClientMessage) => sent.push(m));
    render(<MultiSurface send={send} />);

    fireEvent.click(screen.getByTestId("slot-frame-1-close"));
    // Closed slot 1 is the only vacated id (main stayed at slot 0).
    expect(sent).toContainEqual({ type: "detach_slot", slot: 1 });
    // Auto-collapse: 1 survivor → mode 1.
    const state = useLayoutStore.getState();
    expect(state.mode).toBe(1);
    expect(state.slots).toHaveLength(1);
    expect(state.slots[0].attachedSession).toBe("main");
  });

  test("mode 2 → 1 remount: slot 0's first ready forces select_session for re-seed", () => {
    // Regression: mode-change remounts slot 0's Surface (by design — fresh
    // xterm at new dims avoids term.resize reflow drift vs tmux's own
    // reflow). But backend runtime stays attached, so the new xterm would
    // sit black until tmux emits fresh output. SlotFrame fires an explicit
    // select_session on first ready when attachedSession is already known,
    // which drives attachControlToBaseSession → seedScrollback on backend.
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: "work" }
      ],
      focusedSlot: 0
    });
    const sent: ControlClientMessage[] = [];
    const send = vi.fn((m: ControlClientMessage) => sent.push(m));
    render(<MultiSurface send={send} />);

    fireEvent.click(screen.getByTestId("slot-frame-1-close"));
    expect(useLayoutStore.getState().mode).toBe(1);

    // New slot 0 Surface stub mounts in single-mode; simulating its onReady
    // should drive the re-seed dispatch.
    sent.length = 0;
    fireEvent.click(screen.getByTestId("surface-stub-0-ready"));
    expect(sent).toContainEqual({
      type: "terminal_ready",
      slot: 0,
      cols: 80,
      rows: 24
    });
    expect(sent).toContainEqual({
      type: "select_session",
      slot: 0,
      session: "main"
    });
  });

  test("bootstrap single-mode slot 0 does NOT force select_session", () => {
    // Initial page load: slot 0 starts with attachedSession=null. Backend's
    // ensureAttachedSession owns the auto-pick; if frontend dispatched
    // select_session on first ready it'd race the auto-pick path.
    const sent: ControlClientMessage[] = [];
    const send = vi.fn((m: ControlClientMessage) => sent.push(m));
    render(<MultiSurface send={send} />);
    fireEvent.click(screen.getByTestId("surface-stub-0-ready"));
    expect(sent).toContainEqual({
      type: "terminal_ready",
      slot: 0,
      cols: 80,
      rows: 24
    });
    expect(sent.some((m) => m.type === "select_session")).toBe(false);
  });

  test("close button is hidden in single mode", () => {
    render(<MultiSurface send={vi.fn()} />);
    // Even though slot 0 has no attachedSession in single mode, no mini-bar.
    expect(screen.queryByTestId("slot-frame-0-close")).toBeNull();
  });
});

describe("SlotFrame — empty slot picker", () => {
  test("empty multi-slot shows session list", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: null }
      ],
      focusedSlot: 0
    });
    render(<MultiSurface send={vi.fn()} />);
    expect(screen.getByTestId("slot-frame-1-empty")).toBeTruthy();
    expect(screen.getByTestId("slot-frame-1-pick-main")).toBeTruthy();
    expect(screen.getByTestId("slot-frame-1-pick-work")).toBeTruthy();
  });

  test("empty multi-slot exposes a close button that removes the slot", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: null }
      ],
      focusedSlot: 0
    });
    const sent: ControlClientMessage[] = [];
    const send = vi.fn((m: ControlClientMessage) => sent.push(m));
    render(<MultiSurface send={send} />);
    expect(screen.getByTestId("slot-frame-1-close")).toBeTruthy();
    fireEvent.click(screen.getByTestId("slot-frame-1-close"));
    expect(sent).toContainEqual({ type: "detach_slot", slot: 1 });
    expect(useLayoutStore.getState().mode).toBe(1);
    expect(useLayoutStore.getState().slots[0].attachedSession).toBe("main");
  });

  test("clicking a session in empty picker updates layout-store", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: null }
      ],
      focusedSlot: 0
    });
    render(<MultiSurface send={vi.fn()} />);
    fireEvent.click(screen.getByTestId("slot-frame-1-pick-work"));
    expect(useLayoutStore.getState().slots.find((s) => s.id === 1)?.attachedSession).toBe("work");
    // beginSessionSwitch flag flipped on the slot.
    expect(useTerminalStore.getState().slots[1].sessionSwitchPending).toBe(true);
  });

  test("single-mode slot 0 with null attachedSession still renders Surface (no picker)", () => {
    render(<MultiSurface send={vi.fn()} />);
    expect(screen.queryByTestId("slot-frame-0-empty")).toBeNull();
    expect(screen.getByTestId("surface-stub-0")).toBeTruthy();
  });

  test("session attached in another slot is grayed out + tooltip", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: null }
      ],
      focusedSlot: 1
    });
    render(<MultiSurface send={vi.fn()} />);
    const mainBtn = screen.getByTestId("slot-frame-1-pick-main");
    expect(mainBtn.getAttribute("data-disabled")).toBe("true");
    expect(mainBtn.getAttribute("title") ?? "").toMatch(/(Already open in slot 0|已在 slot 0)/);
    // Other session stays available.
    const workBtn = screen.getByTestId("slot-frame-1-pick-work");
    expect(workBtn.getAttribute("data-disabled")).toBe("false");
  });

  test("clicking a grayed-out session is a no-op", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: null }
      ],
      focusedSlot: 1
    });
    render(<MultiSurface send={vi.fn()} />);
    fireEvent.click(screen.getByTestId("slot-frame-1-pick-main"));
    expect(useLayoutStore.getState().slots.find((s) => s.id === 1)?.attachedSession).toBeNull();
  });

  test("'+ New session' opens the new-session sheet tagged with this slot", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: null }
      ],
      focusedSlot: 1
    });
    useSheetStore.setState({ active: { kind: "none" } });
    render(<MultiSurface send={vi.fn()} />);
    fireEvent.click(screen.getByTestId("slot-frame-1-new-session"));
    const active = useSheetStore.getState().active;
    expect(active.kind).toBe("new-session");
    if (active.kind === "new-session") {
      expect(active.slot).toBe(1);
    }
  });
});

describe("SlotFrame — select_session dispatch sequencing", () => {
  test("multi-mode slot 1 dispatches select_session AFTER terminal_ready", () => {
    useLayoutStore.setState({
      mode: 2,
      slots: [
        { id: 0, attachedSession: "main" },
        { id: 1, attachedSession: "work" }
      ],
      focusedSlot: 0
    });
    const sent: ControlClientMessage[] = [];
    const send = vi.fn((m: ControlClientMessage) => sent.push(m));
    render(<MultiSurface send={send} />);

    // Simulate Surface for slot 1 firing onReady (first measurement).
    fireEvent.click(screen.getByTestId("surface-stub-1-ready"));

    const tr = sent.find((m) => m.type === "terminal_ready" && (m as { slot?: number }).slot === 1);
    const ss = sent.find((m) => m.type === "select_session" && (m as { slot?: number }).slot === 1);
    expect(tr).toBeTruthy();
    expect(ss).toBeTruthy();
    // Order matters: ready first.
    expect(sent.indexOf(tr!)).toBeLessThan(sent.indexOf(ss!));
  });

  test("single-mode slot 0 with pre-known attachedSession DOES dispatch select_session (remount re-seed)", () => {
    // This is the mode 2/4 → 1 remount path. attachedSession is already set
    // at mount time, so the fresh xterm needs the backend to re-seed via
    // attachControlToBaseSession. Bootstrap (null attachedSession) is covered
    // by a separate test.
    useLayoutStore.setState({
      mode: 1,
      slots: [{ id: 0, attachedSession: "main" }],
      focusedSlot: 0
    });
    const sent: ControlClientMessage[] = [];
    const send = vi.fn((m: ControlClientMessage) => sent.push(m));
    render(<MultiSurface send={send} />);

    fireEvent.click(screen.getByTestId("surface-stub-0-ready"));

    expect(sent).toContainEqual({
      type: "select_session",
      slot: 0,
      session: "main"
    });
    expect(sent).toContainEqual({
      type: "terminal_ready",
      slot: 0,
      cols: 80,
      rows: 24
    });
  });
});

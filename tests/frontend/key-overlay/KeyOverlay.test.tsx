// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KeyOverlay } from "../../../src/frontend/features/key-overlay/KeyOverlay.js";
import { useShellStateStore } from "../../../src/frontend/stores/shell-state-store.js";
import {
  initialShellStateResult,
  type ShellState
} from "../../../src/frontend/features/shell-state/state-definitions.js";

function setShellState(state: ShellState, cmd = ""): void {
  useShellStateStore.setState({
    current: {
      ...initialShellStateResult(),
      state,
      confidence: "high",
      paneCurrentCommand: cmd
    },
    previous: null
  });
}

beforeEach(() => {
  // Default to tui — its contextual keys (y/n/?/ /) don't collide with
  // arrow / Ctrl+letter / Fn lookups used throughout these tests.
  setShellState("tui", "claude");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("<KeyOverlay />", () => {
  test("renders null when closed", () => {
    const { container } = render(
      <KeyOverlay open={false} onClose={() => {}} onSend={() => {}} onOpenCompose={() => {}} />
    );
    expect(container.querySelector(".tm-key-overlay")).toBeNull();
  });

  test("when open, renders the overlay container", () => {
    render(
      <KeyOverlay open={true} onClose={() => {}} onSend={() => {}} onOpenCompose={() => {}} />
    );
    expect(document.querySelector(".tm-key-overlay")).not.toBeNull();
  });

  test("renders arrow cluster (↑ ↓ ← →)", () => {
    render(
      <KeyOverlay open={true} onClose={() => {}} onSend={() => {}} onOpenCompose={() => {}} />
    );
    for (const label of ["↑", "↓", "←", "→"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });

  test("renders high-frequency keys (Esc, Tab, Enter, ⌫)", () => {
    render(
      <KeyOverlay open={true} onClose={() => {}} onSend={() => {}} onOpenCompose={() => {}} />
    );
    expect(screen.getByRole("button", { name: /Esc/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Tab/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Enter/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /⌫/ })).toBeDefined();
  });

  test("tapping Esc calls onSend with \\x1b", () => {
    const onSend = vi.fn();
    render(<KeyOverlay open={true} onClose={() => {}} onSend={onSend} onOpenCompose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Esc/ }));
    expect(onSend).toHaveBeenCalledWith("\x1b");
  });

  test("tapping ↑ sends \\x1b[A", () => {
    const onSend = vi.fn();
    render(<KeyOverlay open={true} onClose={() => {}} onSend={onSend} onOpenCompose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "↑" }));
    expect(onSend).toHaveBeenCalledWith("\x1b[A");
  });

  test("Ctrl armed + tapping C sends \\x03 and releases Ctrl", () => {
    const onSend = vi.fn();
    render(<KeyOverlay open={true} onClose={() => {}} onSend={onSend} onOpenCompose={() => {}} />);
    const ctrl = screen.getByRole("button", { name: /^Ctrl$/ });
    fireEvent.pointerDown(ctrl);
    fireEvent.pointerUp(ctrl);
    expect(ctrl.getAttribute("data-mod-state")).toBe("armed");
    const cKey = screen.getByRole("button", { name: /^c$/i });
    fireEvent.click(cKey);
    expect(onSend).toHaveBeenCalledWith("\x03");
    expect(ctrl.getAttribute("data-mod-state")).toBe("idle");
  });

  test("Ctrl locked stays locked after sending a combo", () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    render(<KeyOverlay open={true} onClose={() => {}} onSend={onSend} onOpenCompose={() => {}} />);
    const ctrl = screen.getByRole("button", { name: /^Ctrl$/ });
    fireEvent.pointerDown(ctrl);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(ctrl);
    expect(ctrl.getAttribute("data-mod-state")).toBe("locked");

    const cKey = screen.getByRole("button", { name: /^c$/i });
    fireEvent.click(cKey);
    fireEvent.click(cKey);
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenNthCalledWith(1, "\x03");
    expect(onSend).toHaveBeenNthCalledWith(2, "\x03");
    // Still locked
    expect(ctrl.getAttribute("data-mod-state")).toBe("locked");
  });

  test("Fn toggle button reveals F1-F12 row", () => {
    render(
      <KeyOverlay open={true} onClose={() => {}} onSend={() => {}} onOpenCompose={() => {}} />
    );
    // F1 initially hidden
    expect(screen.queryByRole("button", { name: /^F1$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Fn$/ }));
    expect(screen.getByRole("button", { name: /^F1$/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /^F12$/ })).toBeDefined();
  });

  test("tapping F1 sends SS3 P (\\x1bOP)", () => {
    const onSend = vi.fn();
    render(<KeyOverlay open={true} onClose={() => {}} onSend={onSend} onOpenCompose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Fn$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^F1$/ }));
    expect(onSend).toHaveBeenCalledWith("\x1bOP");
  });

  test("tapping F5 sends CSI 15~", () => {
    const onSend = vi.fn();
    render(<KeyOverlay open={true} onClose={() => {}} onSend={onSend} onOpenCompose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Fn$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^F5$/ }));
    expect(onSend).toHaveBeenCalledWith("\x1b[15~");
  });

  test("compose link button calls onOpenCompose", () => {
    const onOpenCompose = vi.fn();
    render(
      <KeyOverlay open={true} onClose={() => {}} onSend={() => {}} onOpenCompose={onOpenCompose} />
    );
    fireEvent.click(screen.getByRole("button", { name: /文字|compose|✎/i }));
    expect(onOpenCompose).toHaveBeenCalledTimes(1);
  });

  test("handle drag area has aria-hidden for the decorative pull bar", () => {
    render(
      <KeyOverlay open={true} onClose={() => {}} onSend={() => {}} onOpenCompose={() => {}} />
    );
    const handle = document.querySelector(".tm-key-overlay-handle");
    expect(handle?.getAttribute("aria-hidden")).toBe("true");
  });

  test("state-contextual band reflects current ShellState (editor → :wq)", () => {
    setShellState("editor", "vim");
    render(
      <KeyOverlay open={true} onClose={() => {}} onSend={() => {}} onOpenCompose={() => {}} />
    );
    expect(screen.getByRole("button", { name: /:wq/ })).toBeDefined();
  });

  test("state band shows Space when pager active", () => {
    setShellState("pager", "less");
    render(
      <KeyOverlay open={true} onClose={() => {}} onSend={() => {}} onOpenCompose={() => {}} />
    );
    expect(screen.getByRole("button", { name: /Space/ })).toBeDefined();
  });
});

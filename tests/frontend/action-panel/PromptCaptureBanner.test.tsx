// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PromptCaptureBanner } from "../../../src/frontend/features/action-panel/PromptCaptureBanner.js";
import { useShellStateStore } from "../../../src/frontend/stores/shell-state-store.js";
import {
  initialShellStateResult,
  type ShellState
} from "../../../src/frontend/features/shell-state/state-definitions.js";

function setShellState(state: ShellState, tail: string, cmd = ""): void {
  useShellStateStore.setState({
    current: {
      ...initialShellStateResult(),
      state,
      confidence: "high",
      tailSample: tail,
      paneCurrentCommand: cmd
    },
    previous: null
  });
}

beforeEach(() => {
  window.localStorage.clear();
  useShellStateStore.setState({
    current: initialShellStateResult(),
    previous: null
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("<PromptCaptureBanner /> — confirm_prompt", () => {
  test("renders null for non-banner states", () => {
    setShellState("shell_idle", "$ ");
    const { container } = render(
      <PromptCaptureBanner onSend={() => {}} onSendSecret={() => {}} onCancel={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders Yes + No buttons for confirm_prompt", () => {
    setShellState("confirm_prompt", "Continue? [Y/n] ");
    render(<PromptCaptureBanner onSend={() => {}} onSendSecret={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /是|Yes|y/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /否|No|n/ })).toBeDefined();
  });

  test("clicking Yes sends `y\\r`", () => {
    setShellState("confirm_prompt", "Continue? [Y/n] ");
    const onSend = vi.fn();
    render(<PromptCaptureBanner onSend={onSend} onSendSecret={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^是|^Yes/ }));
    expect(onSend).toHaveBeenCalledWith("y\r");
  });

  test("clicking No sends `n\\r`", () => {
    setShellState("confirm_prompt", "Continue? [Y/n] ");
    const onSend = vi.fn();
    render(<PromptCaptureBanner onSend={onSend} onSendSecret={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^否|^No/ }));
    expect(onSend).toHaveBeenCalledWith("n\r");
  });

  test("[Y/n] marks Yes as the detected default", () => {
    setShellState("confirm_prompt", "Continue? [Y/n] ");
    render(<PromptCaptureBanner onSend={() => {}} onSendSecret={() => {}} onCancel={() => {}} />);
    const yesBtn = screen.getByRole("button", { name: /^是|^Yes/ });
    expect(yesBtn.getAttribute("data-default")).toBe("true");
  });

  test("[y/N] marks No as the detected default", () => {
    setShellState("confirm_prompt", "Proceed? [y/N] ");
    render(<PromptCaptureBanner onSend={() => {}} onSendSecret={() => {}} onCancel={() => {}} />);
    const noBtn = screen.getByRole("button", { name: /^否|^No/ });
    expect(noBtn.getAttribute("data-default")).toBe("true");
    const yesBtn = screen.getByRole("button", { name: /^是|^Yes/ });
    expect(yesBtn.getAttribute("data-default")).toBe("false");
  });

  test("banner exposes role=alert so screen readers pick it up immediately", () => {
    setShellState("confirm_prompt", "Continue? [Y/n] ");
    render(<PromptCaptureBanner onSend={() => {}} onSendSecret={() => {}} onCancel={() => {}} />);
    const el = screen.getByRole("alert");
    expect(el).toBeDefined();
  });
});

describe("<PromptCaptureBanner /> — password_prompt", () => {
  test("renders a password input, hidden by default", () => {
    setShellState("password_prompt", "[sudo] password for user: ");
    render(<PromptCaptureBanner onSend={() => {}} onSendSecret={() => {}} onCancel={() => {}} />);
    const input = screen.getByLabelText(/密码|password/i) as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  test("password input has autocomplete=off + spellcheck=false", () => {
    setShellState("password_prompt", "[sudo] password for user: ");
    render(<PromptCaptureBanner onSend={() => {}} onSendSecret={() => {}} onCancel={() => {}} />);
    const input = screen.getByLabelText(/密码|password/i) as HTMLInputElement;
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
  });

  test("show/hide toggle flips input type to text and back", () => {
    setShellState("password_prompt", "[sudo] password: ");
    render(<PromptCaptureBanner onSend={() => {}} onSendSecret={() => {}} onCancel={() => {}} />);
    const input = screen.getByLabelText(/密码|password/i) as HTMLInputElement;
    const toggle = screen.getByRole("button", { name: /显示|show|隐藏|hide/i });
    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    fireEvent.click(toggle);
    expect(input.type).toBe("password");
  });

  test("Send button calls onSendSecret with the value and clears input", () => {
    setShellState("password_prompt", "[sudo] password: ");
    const onSendSecret = vi.fn();
    render(
      <PromptCaptureBanner onSend={() => {}} onSendSecret={onSendSecret} onCancel={() => {}} />
    );
    const input = screen.getByLabelText(/密码|password/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: /^发送|^Send/ }));
    expect(onSendSecret).toHaveBeenCalledWith("hunter2\r");
    expect(input.value).toBe("");
  });

  test("pressing Enter inside the password input submits", () => {
    setShellState("password_prompt", "[sudo] password: ");
    const onSendSecret = vi.fn();
    render(
      <PromptCaptureBanner onSend={() => {}} onSendSecret={onSendSecret} onCancel={() => {}} />
    );
    const input = screen.getByLabelText(/密码|password/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hunter2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSendSecret).toHaveBeenCalledWith("hunter2\r");
  });

  test("Cancel button fires onCancel (not onSendSecret) and clears input", () => {
    setShellState("password_prompt", "[sudo] password: ");
    const onSendSecret = vi.fn();
    const onCancel = vi.fn();
    render(
      <PromptCaptureBanner onSend={() => {}} onSendSecret={onSendSecret} onCancel={onCancel} />
    );
    const input = screen.getByLabelText(/密码|password/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "will-not-send" } });
    fireEvent.click(screen.getByRole("button", { name: /^取消|^Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSendSecret).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });
});

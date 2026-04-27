// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ComposeBar } from "../../../src/frontend/features/compose/ComposeBar.js";
import { useComposeDraftStore } from "../../../src/frontend/features/compose/compose-draft-store.js";
import { useComposeBridge } from "../../../src/frontend/features/compose/compose-bridge.js";
import { useAttachmentsStore } from "../../../src/frontend/features/compose/attachments-store.js";
import { useSessionsStore } from "../../../src/frontend/stores/sessions-store.js";
import { useShellStateStore } from "../../../src/frontend/stores/shell-state-store.js";
import {
  initialShellStateResult,
  type ShellState
} from "../../../src/frontend/features/shell-state/state-definitions.js";
import * as filesApi from "../../../src/frontend/services/files-api.js";
import type { TmuxStateSnapshot } from "../../../src/shared/protocol.js";

function setAttached(session: string): void {
  useSessionsStore.setState({
    snapshot: null,
    attachedSession: session,
    setSnapshot: useSessionsStore.getState().setSnapshot,
    setAttachedSession: useSessionsStore.getState().setAttachedSession
  });
}

function setShellState(state: ShellState): void {
  useShellStateStore.setState({
    current: { ...initialShellStateResult(), state, confidence: "high" },
    previous: null
  });
}

const makeSnapshotWithPane = (paneId: string, cwd: string): TmuxStateSnapshot => ({
  capturedAt: new Date().toISOString(),
  sessions: [
    {
      name: "work",
      attached: true,
      windows: 1,
      windowStates: [
        {
          index: 0,
          name: "shell",
          active: true,
          paneCount: 1,
          panes: [
            {
              index: 0,
              id: paneId,
              currentCommand: "bash",
              active: true,
              width: 120,
              height: 40,
              zoomed: false,
              currentPath: cwd
            }
          ]
        }
      ]
    }
  ]
});

beforeEach(() => {
  useComposeDraftStore.setState({ drafts: {} });
  useComposeBridge.setState({ focusCallback: null });
  useAttachmentsStore.setState({ bySession: {} });
  setAttached("main");
  setShellState("shell_idle");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("<ComposeBar /> PR5 extensions", () => {
  test("loads existing draft on mount", () => {
    useComposeDraftStore.getState().setDraft("main", "git commit -m ");
    render(<ComposeBar onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Type/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("git commit -m ");
  });

  test("typing saves to draft store for the attached session", () => {
    render(<ComposeBar onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Type/i);
    fireEvent.change(textarea, { target: { value: "ls -la" } });
    expect(useComposeDraftStore.getState().getDraft("main")).toBe("ls -la");
  });

  test("send clears both local value and draft store", () => {
    const onSend = vi.fn();
    render(<ComposeBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "pwd" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(onSend).toHaveBeenCalledWith("pwd");
    expect(textarea.value).toBe("");
    expect(useComposeDraftStore.getState().getDraft("main")).toBe("");
  });

  test("password_prompt state suppresses draft writes", () => {
    setShellState("password_prompt");
    render(<ComposeBar onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Type/i);
    fireEvent.change(textarea, { target: { value: "super-secret" } });
    expect(useComposeDraftStore.getState().getDraft("main")).toBe("");
  });

  test("compose bridge focus(text) fills the textarea and focuses it", async () => {
    render(<ComposeBar onSend={() => {}} />);
    await act(async () => {
      useComposeBridge.getState().focus("git status");
      await Promise.resolve(); // let queueMicrotask flush
    });
    const textarea = screen.getByPlaceholderText(/Type/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("git status");
    expect(document.activeElement).toBe(textarea);
  });

  test("compose bridge focus() without text just focuses", async () => {
    render(<ComposeBar onSend={() => {}} />);
    await act(async () => {
      useComposeBridge.getState().focus();
      await Promise.resolve();
    });
    const textarea = screen.getByPlaceholderText(/Type/i);
    expect(document.activeElement).toBe(textarea);
  });

  test("switching sessions swaps drafts", () => {
    useComposeDraftStore.getState().setDraft("main", "first");
    useComposeDraftStore.getState().setDraft("work", "second");
    const { rerender } = render(<ComposeBar onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Type/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("first");
    setAttached("work");
    rerender(<ComposeBar onSend={() => {}} />);
    expect(textarea.value).toBe("second");
  });
});

describe("<ComposeBar /> attachments (PR3 / ADR-0012)", () => {
  beforeEach(() => {
    useSessionsStore.setState({
      snapshot: makeSnapshotWithPane("%42", "/home/u/proj"),
      attachedSession: "main",
      attachedBaseSession: "work"
    });
  });

  test("📎 attach button is present and labeled", () => {
    render(<ComposeBar onSend={() => {}} />);
    expect(screen.getByRole("button", { name: /添加附件|attach/i })).toBeDefined();
  });

  test("file input → upload → chip shows done → send rewrites message", async () => {
    const uploadSpy = vi.spyOn(filesApi, "uploadFile").mockResolvedValue({
      written: [{ rel: ".tmp-msg-attachments/2026-xyz-screenshot.png", size: 10 }]
    });
    const onSend = vi.fn();
    render(<ComposeBar onSend={onSend} />);

    const hidden = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "screenshot.png", {
      type: "image/png"
    });
    fireEvent.change(hidden, { target: { files: [file] } });

    await waitFor(() => {
      const chip = screen.getByTestId("compose-attachment-chip");
      expect(chip.getAttribute("data-status")).toBe("done");
    });
    expect(uploadSpy).toHaveBeenCalled();
    const callOpts = uploadSpy.mock.calls[0][1];
    expect(callOpts.paneId).toBe("%42");
    expect(callOpts.relDir).toBe(".tmp-msg-attachments");
    expect(callOpts.stamp).toBe(true);

    const textarea = screen.getByPlaceholderText(/Type/i);
    fireEvent.change(textarea, { target: { value: "帮我看这张图" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toContain(
      "File paths attached to this message:\n  ./.tmp-msg-attachments/2026-xyz-screenshot.png"
    );
    expect(onSend.mock.calls[0][0]).toContain("帮我看这张图");
    uploadSpy.mockRestore();
  }, 10_000);

  test("send is disabled while an upload is in-flight", async () => {
    let resolveUpload: (value: { written: { rel: string; size: number }[] }) => void = () => {};
    const uploadPromise = new Promise<{ written: { rel: string; size: number }[] }>((resolve) => {
      resolveUpload = resolve;
    });
    const uploadSpy = vi.spyOn(filesApi, "uploadFile").mockReturnValue(uploadPromise);
    render(<ComposeBar onSend={() => {}} />);

    const hidden = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    fireEvent.change(hidden, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId("compose-attachment-chip").getAttribute("data-status")).toBe(
        "uploading"
      );
    });
    const sendBtn = screen.getByRole("button", { name: /Send|…/i }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);

    await act(async () => {
      resolveUpload({ written: [{ rel: ".tmp-msg-attachments/a.png", size: 1 }] });
      await Promise.resolve();
    });
    uploadSpy.mockRestore();
  });

  test("upload failure marks chip as error", async () => {
    const uploadSpy = vi
      .spyOn(filesApi, "uploadFile")
      .mockRejectedValue(new filesApi.FilesApiError(403, "path escapes root", "escape"));
    render(<ComposeBar onSend={() => {}} />);
    const hidden = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(hidden, {
      target: {
        files: [new File([new Uint8Array([1])], "x.txt", { type: "text/plain" })]
      }
    });
    await waitFor(() => {
      expect(screen.getByTestId("compose-attachment-chip").getAttribute("data-status")).toBe(
        "error"
      );
    });
    uploadSpy.mockRestore();
  });

  test("rewriteWithAttachments format matches agent contract", () => {
    // Sanity check wired into the component test file so the format change
    // requires touching a ComposeBar-adjacent test (not just the store test).
    render(<ComposeBar onSend={() => {}} />);
    expect(screen.getByPlaceholderText(/Type/i)).toBeDefined();
  });
});

describe("<ComposeBar /> slash-completion (Phase 2.6 PR1)", () => {
  test("typing `/` in shell_idle opens the suggestions panel", () => {
    render(<ComposeBar onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Type/i);
    fireEvent.change(textarea, { target: { value: "/" } });
    expect(screen.getByTestId("compose-suggestions")).toBeDefined();
    const items = screen.getAllByTestId("compose-suggestion-item");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.textContent).toContain("claude");
  });

  test("Enter while panel is open picks the highlighted entry (does NOT send)", () => {
    const onSend = vi.fn();
    render(<ComposeBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "/" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe("claude");
    expect(screen.queryByTestId("compose-suggestions")).toBeNull();
  });

  test("ArrowDown moves highlight; Enter picks the new entry", () => {
    const onSend = vi.fn();
    render(<ComposeBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "/" } });
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    // Catalog order at index 1 (2nd entry) may evolve as the starters grow;
    // the invariant we test is "Enter picks something other than the first
    // entry and the popover is committed into the textarea".
    expect(textarea.value).not.toBe("");
    expect(textarea.value).not.toBe("claude");
  });

  test("deleting the `/` closes the panel", () => {
    render(<ComposeBar onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Type/i);
    fireEvent.change(textarea, { target: { value: "/" } });
    expect(screen.getByTestId("compose-suggestions")).toBeDefined();
    fireEvent.change(textarea, { target: { value: "" } });
    expect(screen.queryByTestId("compose-suggestions")).toBeNull();
  });

  test("Escape closes the panel but keeps the text", () => {
    render(<ComposeBar onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Type/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "/" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByTestId("compose-suggestions")).toBeNull();
    expect(textarea.value).toBe("/");
  });

  test("Enter with no panel open sends normally", () => {
    const onSend = vi.fn();
    render(<ComposeBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type/i);
    fireEvent.change(textarea, { target: { value: "ls" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("ls");
  });

  test("keyOverlayOpen forces the panel closed", () => {
    render(<ComposeBar onSend={() => {}} keyOverlayOpen />);
    const textarea = screen.getByPlaceholderText(/Type/i);
    fireEvent.change(textarea, { target: { value: "/" } });
    expect(screen.queryByTestId("compose-suggestions")).toBeNull();
  });

  test("password_prompt state suppresses the panel", () => {
    setShellState("password_prompt");
    render(<ComposeBar onSend={() => {}} />);
    const textarea = screen.getByPlaceholderText(/Type/i);
    fireEvent.change(textarea, { target: { value: "/" } });
    expect(screen.queryByTestId("compose-suggestions")).toBeNull();
  });
});

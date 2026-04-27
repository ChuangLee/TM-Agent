// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  startFilePanelUploads,
  useFilePanelUploads
} from "../../../src/frontend/features/files/file-panel-uploads.js";
import * as filesApi from "../../../src/frontend/services/files-api.js";

const mkFile = (name: string): File =>
  new File([new Uint8Array([1])], name, { type: "text/plain" });

beforeEach(() => {
  useFilePanelUploads.setState({
    queue: [],
    decision: null,
    pendingConflict: null
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startFilePanelUploads", () => {
  test("happy path: two files, both succeed", async () => {
    const spy = vi
      .spyOn(filesApi, "uploadFile")
      .mockResolvedValue({ written: [{ rel: "x", size: 1 }] });
    await startFilePanelUploads({
      paneId: "%1",
      relDir: "",
      files: [mkFile("a.txt"), mkFile("b.txt")],
      askForDecision: async () => "overwrite-all"
    });
    const queue = useFilePanelUploads.getState().queue;
    expect(queue.map((q) => q.status)).toEqual(["done", "done"]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("conflict → user picks overwrite-all → second attempt succeeds", async () => {
    const spy = vi
      .spyOn(filesApi, "uploadFile")
      .mockImplementationOnce(() =>
        Promise.reject(new filesApi.FilesApiError(409, "exists", "exists"))
      )
      .mockImplementation(() => Promise.resolve({ written: [{ rel: "x", size: 1 }] }));
    const askForDecision = vi.fn().mockResolvedValue("overwrite-all");
    await startFilePanelUploads({
      paneId: "%1",
      relDir: "",
      files: [mkFile("a.txt"), mkFile("b.txt")],
      askForDecision
    });
    expect(askForDecision).toHaveBeenCalledTimes(1);
    // first call (no overwrite), retry call (overwrite=1), second file call
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[1][1].overwrite).toBe(true);
    const queue = useFilePanelUploads.getState().queue;
    expect(queue.map((q) => q.status)).toEqual(["done", "done"]);
  });

  test("conflict → user picks skip-all → marked error, no retry, decision sticks", async () => {
    const spy = vi
      .spyOn(filesApi, "uploadFile")
      .mockImplementation(() =>
        Promise.reject(new filesApi.FilesApiError(409, "exists", "exists"))
      );
    const askForDecision = vi.fn().mockResolvedValue("skip-all");
    await startFilePanelUploads({
      paneId: "%1",
      relDir: "",
      files: [mkFile("a.txt"), mkFile("b.txt")],
      askForDecision
    });
    // Only the first file provokes the dialog; the second reuses the decision.
    expect(askForDecision).toHaveBeenCalledTimes(1);
    // Each file → one upload call (neither retried).
    expect(spy).toHaveBeenCalledTimes(2);
    const queue = useFilePanelUploads.getState().queue;
    expect(queue.every((q) => q.status === "error")).toBe(true);
  });

  test("non-conflict error is recorded as error without prompt", async () => {
    vi.spyOn(filesApi, "uploadFile").mockRejectedValue(
      new filesApi.FilesApiError(403, "path escapes root", "escape")
    );
    const askForDecision = vi.fn();
    await startFilePanelUploads({
      paneId: "%1",
      relDir: "",
      files: [mkFile("a.txt")],
      askForDecision
    });
    expect(askForDecision).not.toHaveBeenCalled();
    const queue = useFilePanelUploads.getState().queue;
    expect(queue[0].status).toBe("error");
    expect(queue[0].error).toContain("escapes");
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  rewriteWithAttachments,
  useAttachmentsStore,
  type ComposeAttachment
} from "../../../src/frontend/features/compose/attachments-store.js";

const baseAttachment = (patch: Partial<ComposeAttachment> = {}): ComposeAttachment => ({
  id: "a1",
  name: "x.png",
  size: 100,
  mime: "image/png",
  status: "done",
  progress: 1,
  rel: ".tmp-msg-attachments/2026-01-01T00-00-00Z-x.png",
  ...patch
});

describe("rewriteWithAttachments", () => {
  test("no attachments → text unchanged", () => {
    expect(rewriteWithAttachments("hello", [])).toBe("hello");
  });

  test("single done attachment appends `./<rel>` (no fileN label)", () => {
    const out = rewriteWithAttachments("look at this", [baseAttachment()]);
    expect(out).toBe(
      "look at this\n\nFile paths attached to this message:\n  ./.tmp-msg-attachments/2026-01-01T00-00-00Z-x.png"
    );
  });

  test("multiple done attachments get `fileN:` labels to disambiguate", () => {
    const out = rewriteWithAttachments("", [
      baseAttachment({ id: "a", rel: ".tmp-msg-attachments/a.png" }),
      baseAttachment({ id: "b", rel: ".tmp-msg-attachments/b.pdf" })
    ]);
    expect(out).toBe(
      "File paths attached to this message:\n  file1: ./.tmp-msg-attachments/a.png\n  file2: ./.tmp-msg-attachments/b.pdf"
    );
  });

  test("uploading attachments are filtered out until done", () => {
    expect(
      rewriteWithAttachments("x", [baseAttachment({ status: "uploading", rel: undefined })])
    ).toBe("x");
  });

  test("error attachments filtered out", () => {
    expect(
      rewriteWithAttachments("x", [
        baseAttachment({ status: "error", rel: undefined, error: "boom" })
      ])
    ).toBe("x");
  });

  test("trailing whitespace on user text is collapsed before appending", () => {
    const out = rewriteWithAttachments("hi\n  \n", [baseAttachment()]);
    expect(out).toBe(
      "hi\n\nFile paths attached to this message:\n  ./.tmp-msg-attachments/2026-01-01T00-00-00Z-x.png"
    );
  });

  test("rel that already starts with ./ is not double-prefixed", () => {
    const out = rewriteWithAttachments("", [baseAttachment({ rel: "./already-relative.png" })]);
    expect(out).toBe("File paths attached to this message:\n  ./already-relative.png");
  });
});

describe("useAttachmentsStore", () => {
  beforeEach(() => {
    useAttachmentsStore.setState({ bySession: {} });
  });

  test("add + update + remove", () => {
    const store = useAttachmentsStore.getState();
    store.add("main", baseAttachment({ id: "x1", status: "uploading", progress: 0 }));
    expect(store.get("main")).toHaveLength(1);
    store.update("main", "x1", { progress: 0.5 });
    expect(store.get("main")[0].progress).toBe(0.5);
    store.remove("main", "x1");
    expect(store.get("main")).toHaveLength(0);
  });

  test("clear revokes thumbnail object URLs", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const store = useAttachmentsStore.getState();
    store.add("main", baseAttachment({ id: "z", thumbnailUrl: "blob:abc" }));
    store.clear("main");
    expect(revoke).toHaveBeenCalledWith("blob:abc");
    revoke.mockRestore();
  });

  test("remove aborts in-flight upload", () => {
    const abort = new AbortController();
    const abortSpy = vi.spyOn(abort, "abort");
    const store = useAttachmentsStore.getState();
    store.add("main", baseAttachment({ id: "a", abort }));
    store.remove("main", "a");
    expect(abortSpy).toHaveBeenCalled();
  });

  test("clear drops the session entry entirely", () => {
    const store = useAttachmentsStore.getState();
    store.add("main", baseAttachment({ id: "a" }));
    store.clear("main");
    expect(useAttachmentsStore.getState().bySession.main).toBeUndefined();
  });
});

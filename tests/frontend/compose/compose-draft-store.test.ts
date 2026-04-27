import { beforeEach, describe, expect, test } from "vitest";
import { useComposeDraftStore } from "../../../src/frontend/features/compose/compose-draft-store.js";

describe("compose-draft-store", () => {
  beforeEach(() => {
    useComposeDraftStore.setState({ drafts: {} });
  });

  test("getDraft returns '' for unknown session", () => {
    const { getDraft } = useComposeDraftStore.getState();
    expect(getDraft("unknown")).toBe("");
  });

  test("setDraft + getDraft round-trip", () => {
    const { setDraft, getDraft } = useComposeDraftStore.getState();
    setDraft("main", "git commit -m ");
    expect(getDraft("main")).toBe("git commit -m ");
  });

  test("drafts are independent per session", () => {
    const { setDraft, getDraft } = useComposeDraftStore.getState();
    setDraft("main", "ls");
    setDraft("work", "npm run build");
    expect(getDraft("main")).toBe("ls");
    expect(getDraft("work")).toBe("npm run build");
  });

  test("clearDraft removes the session's entry", () => {
    const { setDraft, clearDraft, getDraft } = useComposeDraftStore.getState();
    setDraft("main", "hello");
    clearDraft("main");
    expect(getDraft("main")).toBe("");
  });

  test("setDraft with empty string clears the entry", () => {
    const { setDraft, getDraft } = useComposeDraftStore.getState();
    setDraft("main", "hi");
    setDraft("main", "");
    expect(getDraft("main")).toBe("");
    expect(Object.keys(useComposeDraftStore.getState().drafts)).toEqual([]);
  });

  test("setDraft no-ops when sessionId is empty", () => {
    const { setDraft } = useComposeDraftStore.getState();
    setDraft("", "hello");
    expect(useComposeDraftStore.getState().drafts).toEqual({});
  });
});

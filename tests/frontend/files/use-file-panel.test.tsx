// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useFilePanel } from "../../../src/frontend/features/files/use-file-panel.js";
import { useSessionsStore } from "../../../src/frontend/stores/sessions-store.js";
import { useFileListingsStore } from "../../../src/frontend/stores/file-listings-store.js";
import { useLayoutStore } from "../../../src/frontend/stores/layout-store.js";
import * as filesApi from "../../../src/frontend/services/files-api.js";
import type { TmuxStateSnapshot } from "../../../src/shared/protocol.js";

const snapshotWithPane = (paneId: string, cwd: string): TmuxStateSnapshot => ({
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
  useSessionsStore.setState({
    snapshot: snapshotWithPane("%42", "/home/u/proj"),
    attachedSession: "mobile",
    attachedBaseSession: "work"
  });
  // useActivePane now reads the focused slot's attachedSession; mirror that
  // in layout-store so tests cover the real path.
  useLayoutStore.setState({
    mode: 1,
    focusedSlot: 0,
    slots: [{ id: 0, attachedSession: "work" }]
  });
  // Cache is module-singleton across tests; reset between cases or stale
  // entries leak (and SWR returns the previous test's data).
  useFileListingsStore.setState({ entries: {}, inflight: {} });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useFilePanel", () => {
  test("fetches list for the active pane's cwd on mount", async () => {
    const spy = vi.spyOn(filesApi, "fetchFileList").mockResolvedValue({
      root: "/home/u/proj",
      rel: "",
      items: [{ name: "a.txt", kind: "file", size: 10, mtimeMs: 0, isSymlink: false }]
    });
    const { result } = renderHook(() => useFilePanel());
    await waitFor(() => {
      expect(result.current.listing?.items[0]?.name).toBe("a.txt");
    });
    expect(spy).toHaveBeenCalledWith("%42", "");
  });

  test("enter/up navigation updates rel and breadcrumbs", async () => {
    vi.spyOn(filesApi, "fetchFileList").mockResolvedValue({
      root: "/home/u/proj",
      rel: "",
      items: []
    });
    const { result } = renderHook(() => useFilePanel());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Each nav op must settle (the listing fetch resolves + the lock
    // releases) before the next one is issued — that's the whole point of
    // the re-entry guard below.
    act(() => result.current.enter("src"));
    expect(result.current.rel).toBe("src");
    expect(result.current.breadcrumbs).toEqual(["src"]);
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.enter("backend"));
    expect(result.current.rel).toBe("src/backend");
    expect(result.current.breadcrumbs).toEqual(["src", "backend"]);
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.up());
    expect(result.current.rel).toBe("src");
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.jumpTo(0));
    expect(result.current.rel).toBe("");
  });

  test("ignores re-entrant enter/jumpTo while a nav is in flight", async () => {
    // A never-resolving fetch keeps the lock engaged; the second click is
    // the one that used to produce `src/src` and a 404.
    vi.spyOn(filesApi, "fetchFileList").mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useFilePanel());

    act(() => result.current.enter("src"));
    expect(result.current.rel).toBe("src");

    act(() => result.current.enter("src"));
    expect(result.current.rel).toBe("src");

    act(() => result.current.jumpTo(0));
    expect(result.current.rel).toBe("src");

    act(() => result.current.up());
    expect(result.current.rel).toBe("src");
  });

  test("rehomes to root when pane cwd changes", async () => {
    vi.spyOn(filesApi, "fetchFileList").mockResolvedValue({
      root: "/home/u/proj",
      rel: "",
      items: []
    });
    const { result } = renderHook(() => useFilePanel());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.enter("src"));
    expect(result.current.rel).toBe("src");

    // Simulate shell `cd` by replacing the snapshot.
    act(() => {
      useSessionsStore.setState({
        snapshot: snapshotWithPane("%42", "/opt/new"),
        attachedSession: "mobile",
        attachedBaseSession: "work"
      });
    });
    await waitFor(() => expect(result.current.rootCwd).toBe("/opt/new"));
    expect(result.current.rel).toBe("");
  });

  test("surfaces 403 errors as a string", async () => {
    vi.spyOn(filesApi, "fetchFileList").mockRejectedValue(
      new filesApi.FilesApiError(403, "path escapes root", "escape")
    );
    const { result } = renderHook(() => useFilePanel());
    await waitFor(() => expect(result.current.error).toBe("path escapes root"));
  });

  test("serves cached listing instantly on remount (SWR)", async () => {
    const spy = vi.spyOn(filesApi, "fetchFileList").mockResolvedValue({
      root: "/home/u/proj",
      rel: "",
      items: [{ name: "first.txt", kind: "file", size: 1, mtimeMs: 0, isSymlink: false }]
    });
    const { result, unmount } = renderHook(() => useFilePanel());
    await waitFor(() => expect(result.current.listing).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();

    // Second mount: cache hit means listing is non-null on the very first
    // render (no spinner). Background revalidate fires a second HTTP call.
    const second = renderHook(() => useFilePanel());
    expect(second.result.current.listing?.items[0]?.name).toBe("first.txt");
    expect(second.result.current.loading).toBe(false);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  test("refresh() drops the pane's cache and refetches", async () => {
    const spy = vi
      .spyOn(filesApi, "fetchFileList")
      .mockResolvedValueOnce({
        root: "/home/u/proj",
        rel: "",
        items: [{ name: "a", kind: "file", size: 1, mtimeMs: 0, isSymlink: false }]
      })
      .mockResolvedValueOnce({
        root: "/home/u/proj",
        rel: "",
        items: [{ name: "b", kind: "file", size: 1, mtimeMs: 0, isSymlink: false }]
      });
    const { result } = renderHook(() => useFilePanel());
    await waitFor(() => expect(result.current.listing?.items[0]?.name).toBe("a"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.listing?.items[0]?.name).toBe("b"));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

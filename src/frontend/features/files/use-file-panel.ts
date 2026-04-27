import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilesApiError, type FileListing } from "../../services/files-api.js";
import { useActivePane, selectSlotActivePane } from "../compose/use-active-pane.js";
import { useFileListingsStore } from "../../stores/file-listings-store.js";
import { useLayoutStore } from "../../stores/layout-store.js";
import { useSessionsStore } from "../../stores/sessions-store.js";

export interface FilePanelState {
  /** Current pane id (empty when no attached pane). */
  paneId: string;
  /** The pane's cwd — used as the FilePanel root. */
  rootCwd: string;
  /** Relative path the user is browsing (forward-slash, no leading /). */
  rel: string;
  /** Breadcrumb segments derived from rel. */
  breadcrumbs: string[];
  listing: FileListing | null;
  loading: boolean;
  error: string | null;
  refresh(): void;
  /** Navigate into a child directory by name. */
  enter(name: string): void;
  /** Navigate up one level. No-op when already at root. */
  up(): void;
  /** Jump to a specific depth in the breadcrumb chain (0 = root). */
  jumpTo(depth: number): void;
}

/**
 * FilePanel data + navigation hook. Tracks the *focused slot's* active pane
 * (see useActivePane) so switching between multi-pane slots also flips the
 * file root. Listings are served stale-while-revalidate from
 * useFileListingsStore — when the user re-visits a directory or flips back
 * to a slot they had open earlier, the rows appear instantly while a
 * background refetch updates them.
 */
export function useFilePanel(): FilePanelState {
  const { paneId, currentPath } = useActivePane();
  const [rel, setRel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fetchTick, setFetchTick] = useState(0);
  // Synchronously blocks re-entrant navigation. Without this, a rapid
  // second click on a folder row (or a breadcrumb) lands while `setRel` is
  // still pending — the stale list is still on screen, so the second click
  // fires `enter("foo")` again and `rel` becomes `"foo/foo"`, yielding a
  // 404. Held between the click and the next listing resolving.
  const navLockRef = useRef(false);

  const cached = useFileListingsStore((s) =>
    paneId ? (s.entries[`${paneId}:${rel}`] ?? null) : null
  );
  const inflight = useFileListingsStore((s) =>
    paneId ? Boolean(s.inflight[`${paneId}:${rel}`]) : false
  );
  const loadListing = useFileListingsStore((s) => s.load);
  const invalidatePane = useFileListingsStore((s) => s.invalidate);

  // Rehome on root change. The pane's cwd changing means the user `cd`'d in
  // the shell or focus flipped to a slot whose pane is rooted elsewhere —
  // either way `rel` no longer makes sense.
  useEffect(() => {
    setRel("");
  }, [currentPath]);

  // Listing fetch + revalidate. `cached` is rendered immediately; the
  // background load updates it (or surfaces a fresh error). We swallow
  // revalidate errors when there's already a cached entry — the stale
  // list stays visible and the user can hit refresh.
  useEffect(() => {
    if (!paneId || !currentPath) {
      navLockRef.current = false;
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    loadListing(paneId, rel)
      .then(() => {
        if (cancelled) return;
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message =
          e instanceof FilesApiError ? e.message : e instanceof Error ? e.message : String(e);
        setError(message);
      })
      .finally(() => {
        if (!cancelled) navLockRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [paneId, currentPath, rel, fetchTick, loadListing]);

  const refresh = useCallback((): void => {
    if (paneId) invalidatePane(paneId);
    setFetchTick((n) => n + 1);
  }, [paneId, invalidatePane]);

  const enter = useCallback((name: string): void => {
    if (navLockRef.current) return;
    navLockRef.current = true;
    setRel((cur) => (cur ? `${cur}/${name}` : name));
  }, []);

  const up = useCallback((): void => {
    if (navLockRef.current) return;
    if (!rel) return;
    navLockRef.current = true;
    const parts = rel.split("/");
    parts.pop();
    setRel(parts.join("/"));
  }, [rel]);

  const jumpTo = useCallback(
    (depth: number): void => {
      if (navLockRef.current) return;
      const next = depth <= 0 ? "" : rel.split("/").slice(0, depth).join("/");
      if (next === rel) return;
      navLockRef.current = true;
      setRel(next);
    },
    [rel]
  );

  const breadcrumbs = useMemo(() => (rel ? rel.split("/") : []), [rel]);
  // Loading is "no cache + still fetching". A stale-but-cached listing
  // shouldn't show the spinner — that's the whole point of SWR.
  const loading = !cached && inflight;
  const listing = cached?.listing ?? null;

  return {
    paneId,
    rootCwd: currentPath,
    rel,
    breadcrumbs,
    listing,
    loading,
    error: cached ? null : error,
    refresh,
    enter,
    up,
    jumpTo
  };
}

/**
 * Background prefetch hook. Whenever the focused slot changes, kick off a
 * root-listing fetch for every *other* slot's active pane so flipping focus
 * later renders instantly from cache. Cheap: each slot adds at most one HTTP
 * request, coalesced via the store's inflight map.
 *
 * Mounted once at App scope (alongside useSlotFocusShortcuts).
 */
export function useFilePanelPrefetch(): void {
  const focusedSlot = useLayoutStore((s) => s.focusedSlot);
  const slots = useLayoutStore((s) => s.slots);
  const snapshot = useSessionsStore((s) => s.snapshot);
  const load = useFileListingsStore((s) => s.load);

  useEffect(() => {
    if (!snapshot) return;
    for (const slot of slots) {
      if (slot.id === focusedSlot) continue;
      const { paneId } = selectSlotActivePane(snapshot, slot.attachedSession);
      if (!paneId) continue;
      const cached = useFileListingsStore.getState().entries[`${paneId}:`];
      if (cached) continue; // already warm
      // Fire and forget — failures will surface when the user actually
      // focuses that slot. Wrap in try/catch via .catch() to avoid
      // unhandled rejection noise.
      load(paneId, "").catch(() => {});
    }
  }, [focusedSlot, slots, snapshot, load]);
}

import { create } from "zustand";
import { fetchFileList, FilesApiError, type FileListing } from "../services/files-api.js";

/**
 * Local stale-while-revalidate cache for FilePanel listings.
 *
 * Keyed by `${paneId}:${rel}`. The cache lets FilePanel render *immediately*
 * when the user switches focus between slots (or revisits a directory) while
 * a background refetch updates the rows. Without it, every focus/folder
 * change blanked the panel until the HTTP round-trip completed — painful in
 * multi-slot layouts where switching focus also flips the file root.
 *
 * Invalidation is conservative: we don't watch tmux state for `cd` or shell
 * commands. Instead, FilePanel's manual refresh and any successful
 * upload/delete/rename calls `invalidate(paneId)` to drop that pane's
 * entries. A full hour-old entry is treated as fresh in-session (no TTL
 * eviction); the page-reload cycle clears the store.
 */

export interface CachedListing {
  listing: FileListing;
  fetchedAt: number;
}

interface FileListingsState {
  entries: Record<string, CachedListing>;
  inflight: Record<string, Promise<FileListing>>;
  /** Read a cached listing, returns null if not cached. */
  get(paneId: string, rel: string): CachedListing | null;
  /**
   * Fetch (or revalidate) and cache. Coalesces concurrent calls for the
   * same key into one HTTP request. Throws on error so callers can show
   * the message; a failed revalidate does NOT clear the cached entry.
   */
  load(paneId: string, rel: string): Promise<FileListing>;
  /** Drop all entries whose paneId matches. */
  invalidate(paneId: string): void;
  /** Drop a single entry — used after successful rename/delete on its parent. */
  invalidateEntry(paneId: string, rel: string): void;
}

const keyOf = (paneId: string, rel: string): string => `${paneId}:${rel}`;

export const useFileListingsStore = create<FileListingsState>((set, get) => ({
  entries: {},
  inflight: {},
  get: (paneId, rel) => {
    if (!paneId) return null;
    return get().entries[keyOf(paneId, rel)] ?? null;
  },
  load: (paneId, rel) => {
    const key = keyOf(paneId, rel);
    const existing = get().inflight[key];
    if (existing) return existing;
    const promise = fetchFileList(paneId, rel)
      .then((listing) => {
        set((state) => ({
          entries: {
            ...state.entries,
            [key]: { listing, fetchedAt: Date.now() }
          },
          inflight: stripKey(state.inflight, key)
        }));
        return listing;
      })
      .catch((error: unknown) => {
        set((state) => ({ inflight: stripKey(state.inflight, key) }));
        if (error instanceof FilesApiError) throw error;
        throw error instanceof Error ? error : new Error(String(error));
      });
    set((state) => ({
      inflight: { ...state.inflight, [key]: promise }
    }));
    return promise;
  },
  invalidate: (paneId) => {
    if (!paneId) return;
    set((state) => {
      const prefix = `${paneId}:`;
      const next: Record<string, CachedListing> = {};
      for (const [k, v] of Object.entries(state.entries)) {
        if (!k.startsWith(prefix)) next[k] = v;
      }
      return { entries: next };
    });
  },
  invalidateEntry: (paneId, rel) => {
    set((state) => {
      const key = keyOf(paneId, rel);
      if (!(key in state.entries)) return state;
      const next = { ...state.entries };
      delete next[key];
      return { entries: next };
    });
  }
}));

const stripKey = <T>(map: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
};

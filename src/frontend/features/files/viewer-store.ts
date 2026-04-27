import { create } from "zustand";

export interface ViewerTarget {
  paneId: string;
  rel: string;
  /** Display name — last path segment. */
  name: string;
  /** MIME sniffed by the server on `/meta`. */
  mime: string;
  /** Size in bytes, used to short-circuit oversized previews. */
  size: number;
}

interface ViewerState {
  target: ViewerTarget | null;
  open(target: ViewerTarget): void;
  close(): void;
}

/**
 * Shared state for the FileViewer overlay (PR5). The FilePanel (PR4) writes
 * to this when a file is clicked; the viewer reads and renders. Kept in its
 * own store so `FilePanel.tsx` doesn't need to know how the viewer is
 * rendered or mounted.
 */
export const useViewerStore = create<ViewerState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null })
}));

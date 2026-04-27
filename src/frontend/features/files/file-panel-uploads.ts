import { create } from "zustand";
import i18n from "../../i18n/index.js";
import { FilesApiError, uploadFile } from "../../services/files-api.js";

export type UploadStatus = "uploading" | "done" | "error" | "conflict";

export interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  abort?: AbortController;
}

export type ConflictDecision = "overwrite-all" | "skip-all" | "ask";

interface FilePanelUploadsState {
  queue: UploadItem[];
  /**
   * Policy for handling existing-file conflicts during the current batch.
   * Null while in "ask" mode; cleared when the queue is empty.
   */
  decision: ConflictDecision | null;
  /** Pending conflict that needs a user decision ("ask" mode). */
  pendingConflict: { id: string; resume: (decision: ConflictDecision) => void } | null;

  push(items: UploadItem[]): void;
  update(id: string, patch: Partial<UploadItem>): void;
  dismissDone(): void;
  setDecision(decision: ConflictDecision | null): void;
  setPendingConflict(conflict: FilePanelUploadsState["pendingConflict"]): void;
  clear(): void;
}

export const useFilePanelUploads = create<FilePanelUploadsState>((set) => ({
  queue: [],
  decision: null,
  pendingConflict: null,
  push(items) {
    set((s) => ({ queue: [...s.queue, ...items] }));
  },
  update(id, patch) {
    set((s) => ({
      queue: s.queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
    }));
  },
  dismissDone() {
    set((s) => ({
      queue: s.queue.filter((q) => q.status !== "done")
    }));
  },
  setDecision(decision) {
    set({ decision });
  },
  setPendingConflict(conflict) {
    set({ pendingConflict: conflict });
  },
  clear() {
    set({ queue: [], decision: null, pendingConflict: null });
  }
}));

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface StartUploadsArgs {
  paneId: string;
  relDir: string;
  files: File[];
  /**
   * Called when the first EEXIST_CONFLICT surfaces and no batch decision has
   * been set yet. The returned promise should resolve to the user's choice.
   * The flow pauses the conflicting upload until the decision arrives.
   */
  askForDecision(): Promise<ConflictDecision>;
  onAllComplete?(): void;
}

/**
 * Kick off a FilePanel drag-drop upload batch. Conflict strategy is
 * per-batch: after the first 409 the user picks one policy that applies to
 * every remaining file.
 */
export async function startFilePanelUploads(args: StartUploadsArgs): Promise<void> {
  const { paneId, relDir, files } = args;
  const store = useFilePanelUploads;
  const items: UploadItem[] = files.map((file) => ({
    id: randomId(),
    file,
    status: "uploading",
    progress: 0,
    abort: new AbortController()
  }));
  store.getState().push(items);

  const getDecision = async (): Promise<ConflictDecision> => {
    const existing = store.getState().decision;
    if (existing) return existing;
    const chosen = await args.askForDecision();
    if (chosen !== "ask") {
      store.getState().setDecision(chosen);
    }
    return chosen;
  };

  for (const item of items) {
    try {
      const first = await uploadFile(item.file, {
        paneId,
        relDir,
        onProgress: (fraction) => store.getState().update(item.id, { progress: fraction }),
        signal: item.abort?.signal
      });
      void first;
      store.getState().update(item.id, { status: "done", progress: 1 });
    } catch (error) {
      if (error instanceof FilesApiError && error.kind === "exists") {
        const decision = await getDecision();
        if (decision === "skip-all") {
          store.getState().update(item.id, {
            status: "error",
            error: i18n.t("files.skipExists")
          });
          continue;
        }
        if (decision === "overwrite-all") {
          try {
            await uploadFile(item.file, {
              paneId,
              relDir,
              overwrite: true,
              onProgress: (fraction) => store.getState().update(item.id, { progress: fraction }),
              signal: item.abort?.signal
            });
            store.getState().update(item.id, { status: "done", progress: 1 });
          } catch (e2: unknown) {
            const message =
              e2 instanceof FilesApiError
                ? e2.message
                : e2 instanceof Error
                  ? e2.message
                  : String(e2);
            store.getState().update(item.id, { status: "error", error: message });
          }
          continue;
        }
        // "ask" case — should never land here because getDecision re-
        // prompts. Treat as skip.
        store.getState().update(item.id, { status: "error", error: i18n.t("files.skipped") });
        continue;
      }
      const message =
        error instanceof FilesApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      store.getState().update(item.id, { status: "error", error: message });
    }
  }

  args.onAllComplete?.();
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement
} from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileListItem } from "../../services/files-api.js";
import { useFilePanel } from "./use-file-panel.js";
import { useViewerStore } from "./viewer-store.js";
import {
  buildAuthedMediaUrl,
  deleteFile,
  fetchFileMeta,
  FilesApiError,
  renameFile
} from "../../services/files-api.js";
import { BottomSheet } from "../../components/BottomSheet.js";
import {
  startFilePanelUploads,
  useFilePanelUploads,
  type ConflictDecision
} from "./file-panel-uploads.js";

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const iconFor = (item: FileListItem): string => {
  if (item.kind === "directory") return item.isSymlink ? "🔗" : "📁";
  if (item.isSymlink) return "🔗";
  return "📄";
};

export function FilePanel(): ReactElement {
  const { t } = useTranslation();
  const panel = useFilePanel();
  const openViewer = useViewerStore((s) => s.open);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [conflictPrompt, setConflictPrompt] = useState<
    ((decision: ConflictDecision) => void) | null
  >(null);
  const [showHidden, setShowHidden] = useState(false);
  const [wrapNames, setWrapNames] = useState(false);
  const [rowMenu, setRowMenu] = useState<{
    item: FileListItem;
    anchor: { top: number; right: number };
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<FileListItem | null>(null);
  const uploadQueue = useFilePanelUploads((s) => s.queue);
  const dismissDone = useFilePanelUploads((s) => s.dismissDone);
  const clearUploads = useFilePanelUploads((s) => s.clear);

  const items = useMemo(() => {
    const allItems = panel.listing?.items ?? [];
    return showHidden ? allItems : allItems.filter((i) => !i.name.startsWith("."));
  }, [panel.listing?.items, showHidden]);

  // Each rendered row registers itself via `ref={virtualizer.measureElement}`
  // so the virtualizer uses the real height. In truncate mode rows stay at
  // min-h-8 (32px). In wrap mode long filenames grow to 2–3 lines and the
  // virtualizer re-measures on the ResizeObserver tick.
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 32,
    overscan: 10
  });

  const handleItemClick = async (item: FileListItem): Promise<void> => {
    if (item.kind === "directory") {
      panel.enter(item.name);
      return;
    }
    if (item.kind !== "file") return;
    // Fetch /meta to get the server-sniffed mime before opening the viewer
    // — avoids guessing on the client and gives the viewer a definitive
    // signal.
    try {
      const childRel = panel.rel ? `${panel.rel}/${item.name}` : item.name;
      const meta = await fetchFileMeta(panel.paneId, childRel);
      openViewer({
        paneId: panel.paneId,
        rel: childRel,
        name: item.name,
        mime: meta.mime,
        size: meta.size
      });
    } catch (error) {
      // Silently ignore for now; PR5 viewer will surface its own errors.
      console.warn("meta fetch failed", error);
    }
  };

  const startUploads = useCallback(
    async (files: File[]): Promise<void> => {
      if (!panel.paneId || files.length === 0) return;
      await startFilePanelUploads({
        paneId: panel.paneId,
        relDir: panel.rel,
        files,
        askForDecision: () =>
          new Promise<ConflictDecision>((resolve) => {
            setConflictPrompt(() => (d: ConflictDecision) => {
              setConflictPrompt(null);
              resolve(d);
            });
          }),
        onAllComplete: () => {
          panel.refresh();
        }
      });
    },
    [panel]
  );

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    void startUploads(Array.from(files));
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (e.currentTarget === e.target) setDragOver(false);
  };

  const handleUploadClick = (): void => fileInputRef.current?.click();

  const runDelete = useCallback(
    async (item: FileListItem): Promise<void> => {
      if (!panel.paneId) return;
      const childRel = panel.rel ? `${panel.rel}/${item.name}` : item.name;
      const pretty =
        item.kind === "directory" ? t("files.deleteDirPrefix", { name: item.name }) : item.name;
      const ok = window.confirm(t("files.deleteConfirm", { pretty }));
      if (!ok) return;
      try {
        await deleteFile(panel.paneId, childRel, {
          recursive: item.kind === "directory"
        });
        panel.refresh();
      } catch (error) {
        const msg = error instanceof FilesApiError ? error.message : String(error);
        window.alert(t("files.deleteFailed", { msg }));
      }
    },
    [panel, t]
  );

  const submitRename = useCallback(
    async (item: FileListItem, newName: string): Promise<void> => {
      if (!panel.paneId) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === item.name) return;
      if (/[/\\]/.test(trimmed)) {
        window.alert(t("files.renameSlash"));
        return;
      }
      const fromRel = panel.rel ? `${panel.rel}/${item.name}` : item.name;
      const toRel = panel.rel ? `${panel.rel}/${trimmed}` : trimmed;
      try {
        await renameFile(panel.paneId, fromRel, toRel);
        panel.refresh();
      } catch (error) {
        const msg = error instanceof FilesApiError ? error.message : String(error);
        window.alert(t("files.renameFailed", { msg }));
      }
    },
    [panel, t]
  );

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) void startUploads(Array.from(files));
    e.target.value = "";
  };

  // Auto-clear the queue when everything settles.
  useEffect(() => {
    if (uploadQueue.length === 0) return;
    const allSettled = uploadQueue.every((q) => q.status === "done" || q.status === "error");
    if (allSettled) {
      const t = window.setTimeout(() => clearUploads(), 3000);
      return () => window.clearTimeout(t);
    }
  }, [uploadQueue, clearUploads]);

  const currentDir = panel.rel || t("files.currentDir");

  return (
    <div
      data-testid="file-panel"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`relative flex h-full min-h-0 flex-col ${
        dragOver ? "ring-2 ring-accent/60 ring-inset" : ""
      }`}
    >
      <FilePanelHeader
        breadcrumbs={panel.breadcrumbs}
        rootCwd={panel.rootCwd}
        onJump={panel.jumpTo}
        onUp={panel.up}
        upDisabled={panel.breadcrumbs.length === 0}
        onRefresh={panel.refresh}
        loading={panel.loading}
        onUploadClick={handleUploadClick}
        uploadDisabled={!panel.paneId}
        showHidden={showHidden}
        onToggleHidden={() => setShowHidden((v) => !v)}
        wrapNames={wrapNames}
        onToggleWrapNames={() => setWrapNames((v) => !v)}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInput}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      {!panel.paneId && <p className="px-3 py-4 text-xs text-ink-mute">{t("files.waitingPane")}</p>}
      {panel.paneId && !panel.rootCwd && (
        <p className="px-3 py-4 text-xs text-ink-mute">{t("files.noCwd")}</p>
      )}
      {panel.error && <p className="px-3 py-4 text-xs text-err">{panel.error}</p>}
      {panel.listing && items.length === 0 && !panel.loading && (
        <p className="px-3 py-4 text-xs text-ink-mute">{t("files.empty")}</p>
      )}

      {dragOver && (
        <div
          data-testid="file-panel-drop-overlay"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-bg/70 backdrop-blur-sm"
        >
          <p className="rounded-md border border-accent/60 bg-bg-elev px-4 py-2 text-center text-xs text-ink">
            {t("files.dropHint")}
            <br />
            <span className="font-mono text-accent">{currentDir}</span>
          </p>
        </div>
      )}

      <UploadQueueStrip queue={uploadQueue} onDismiss={dismissDone} />
      {conflictPrompt && <ConflictDialog onDecide={(d) => conflictPrompt(d)} />}

      <RowActionMenu
        menu={rowMenu}
        paneId={panel.paneId}
        relDir={panel.rel}
        onClose={() => setRowMenu(null)}
        onView={(item) => {
          setRowMenu(null);
          void handleItemClick(item);
        }}
        onRename={(item) => {
          setRowMenu(null);
          setRenameTarget(item);
        }}
        onDelete={(item) => {
          setRowMenu(null);
          void runDelete(item);
        }}
      />
      <RenameSheet
        item={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSubmit={(item, newName) => {
          setRenameTarget(null);
          void submitRename(item, newName);
        }}
      />

      <div ref={listRef} className="flex-1 overflow-y-auto px-1" style={{ contain: "strict" }}>
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative"
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const item = items[vi.index];
            return (
              <div
                key={item.name}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                data-testid="file-panel-item"
                data-kind={item.kind}
                className="group flex min-h-8 w-full items-center gap-1 rounded px-1 py-1 text-xs hover:bg-bg-raised"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`
                }}
              >
                <button
                  type="button"
                  onClick={() => void handleItemClick(item)}
                  data-testid="file-panel-item-name"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 text-left"
                >
                  <span aria-hidden="true" className="w-4 shrink-0 text-sm leading-none">
                    {iconFor(item)}
                  </span>
                  <span
                    className={`min-w-0 flex-1 font-mono ${wrapNames ? "break-all" : "truncate"}`}
                  >
                    {item.name}
                  </span>
                </button>
                {item.kind === "file" && (
                  <span className="shrink-0 text-[10px] text-ink-mute">
                    {formatBytes(item.size)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setRowMenu({
                      item,
                      anchor: {
                        top: r.bottom + 4,
                        right: window.innerWidth - r.right
                      }
                    });
                  }}
                  aria-label={t("files.rowActionAria", { name: item.name })}
                  aria-haspopup="menu"
                  aria-expanded={rowMenu?.item.name === item.name}
                  data-testid="file-panel-item-menu"
                  className="shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-ink-dim hover:bg-bg-elev hover:text-ink"
                >
                  ⋯
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UploadQueueStrip({
  queue,
  onDismiss
}: {
  queue: ReturnType<typeof useFilePanelUploads.getState>["queue"];
  onDismiss: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  if (queue.length === 0) return null;
  const doneCount = queue.filter((q) => q.status === "done").length;
  const errorCount = queue.filter((q) => q.status === "error").length;
  const uploading = queue.filter((q) => q.status === "uploading");
  return (
    <div
      data-testid="file-panel-uploads"
      className="flex shrink-0 items-center gap-2 border-t border-line bg-bg-elev px-2 py-1 text-[10px] text-ink-mute"
    >
      <span className="font-mono">
        {t("files.uploadCount", { done: doneCount, total: queue.length })}
        {errorCount > 0 ? t("files.uploadErrors", { count: errorCount }) : ""}
      </span>
      {uploading.length > 0 && (
        <span className="truncate font-mono text-ink">
          {uploading[0].file.name} {Math.round(uploading[0].progress * 100)}%
        </span>
      )}
      <span className="flex-1" />
      {doneCount + errorCount === queue.length && (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-1.5 py-0.5 text-ink-dim hover:bg-bg-raised hover:text-ink"
        >
          {t("files.clearQueue")}
        </button>
      )}
    </div>
  );
}

function ConflictDialog({ onDecide }: { onDecide: (d: ConflictDecision) => void }): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      data-testid="file-panel-conflict-dialog"
      className="absolute inset-0 z-20 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm"
    >
      <div className="max-w-xs rounded-md border border-line-strong bg-bg-elev p-3 text-center text-xs text-ink shadow-lg">
        <p className="mb-2 font-semibold">{t("files.conflictTitle")}</p>
        <p className="mb-3 text-ink-dim">{t("files.conflictPrompt")}</p>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => onDecide("overwrite-all")}
            className="rounded bg-accent px-3 py-1.5 text-bg hover:bg-[#93cdff]"
          >
            {t("files.overwriteAll")}
          </button>
          <button
            type="button"
            onClick={() => onDecide("skip-all")}
            className="rounded border border-line-strong px-3 py-1.5 text-ink hover:bg-bg-raised"
          >
            {t("files.skipAll")}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilePanelHeader({
  breadcrumbs,
  rootCwd,
  onJump,
  onUp,
  upDisabled,
  onRefresh,
  loading,
  onUploadClick,
  uploadDisabled,
  showHidden,
  onToggleHidden,
  wrapNames,
  onToggleWrapNames
}: {
  breadcrumbs: string[];
  rootCwd: string;
  onJump: (depth: number) => void;
  onUp: () => void;
  upDisabled: boolean;
  onRefresh: () => void;
  loading: boolean;
  onUploadClick: () => void;
  uploadDisabled: boolean;
  showHidden: boolean;
  onToggleHidden: () => void;
  wrapNames: boolean;
  onToggleWrapNames: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!overflowOpen) return;
    const onDocPointer = (e: MouseEvent): void => {
      const root = overflowRef.current;
      if (root && !root.contains(e.target as Node)) setOverflowOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);
  const rootLabel = rootCwd ? rootCwd.split("/").filter(Boolean).pop() || "/" : "—";
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5 text-[11px] text-ink">
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        data-testid="file-panel-breadcrumbs"
      >
        <button
          type="button"
          title={rootCwd || "root"}
          onClick={() => onJump(0)}
          className="truncate rounded px-1 font-mono text-ink hover:bg-bg-raised"
        >
          {rootLabel}
        </button>
        {breadcrumbs.map((seg, idx) => (
          <span key={idx} className="flex items-center gap-1">
            <span aria-hidden="true" className="text-ink-mute">
              /
            </span>
            <button
              type="button"
              onClick={() => onJump(idx + 1)}
              className="truncate rounded px-1 font-mono hover:bg-bg-raised"
            >
              {seg}
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onUp}
        disabled={upDisabled}
        aria-label={t("files.parentDir")}
        title={t("files.parentDir")}
        data-testid="file-panel-up"
        className="flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-ink-dim hover:bg-bg-raised hover:text-ink disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-dim"
      >
        <UpIcon />
      </button>
      <button
        type="button"
        onClick={onToggleHidden}
        aria-pressed={showHidden}
        aria-label={showHidden ? t("files.hiddenHide") : t("files.hiddenShow")}
        title={showHidden ? t("files.hiddenHideTooltip") : t("files.hiddenShowTooltip")}
        data-testid="file-panel-hidden-toggle"
        className={`flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 hover:bg-bg-raised ${
          showHidden ? "text-ink" : "text-ink-dim hover:text-ink"
        }`}
      >
        <EyeIcon open={showHidden} />
      </button>
      <button
        type="button"
        onClick={onToggleWrapNames}
        aria-pressed={wrapNames}
        aria-label={wrapNames ? t("files.wrapSingle") : t("files.wrapMulti")}
        title={wrapNames ? t("files.wrapSingleTooltip") : t("files.wrapMultiTooltip")}
        data-testid="file-panel-wrap-toggle"
        className={`flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 hover:bg-bg-raised ${
          wrapNames ? "text-ink" : "text-ink-dim hover:text-ink"
        }`}
      >
        <WrapTextIcon />
      </button>
      <div ref={overflowRef} className="relative">
        <button
          type="button"
          onClick={() => setOverflowOpen((v) => !v)}
          aria-label={t("files.moreActions")}
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
          data-testid="file-panel-overflow"
          className="flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-ink-dim hover:bg-bg-raised hover:text-ink"
        >
          ⋯
        </button>
        {overflowOpen && (
          <div
            role="menu"
            data-testid="file-panel-overflow-menu"
            className="absolute right-0 top-full z-30 mt-1 min-w-[140px] overflow-hidden rounded-md border border-line bg-bg-elev text-[11px] text-ink shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOverflowOpen(false);
                if (!uploadDisabled) onUploadClick();
              }}
              disabled={uploadDisabled}
              data-testid="file-panel-overflow-upload"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-raised disabled:opacity-40"
            >
              <UploadIcon />
              <span>{t("files.uploadMenu")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOverflowOpen(false);
                onRefresh();
              }}
              data-testid="file-panel-overflow-refresh"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-raised"
            >
              <RefreshIcon spinning={loading} />
              <span>{t("files.refresh")}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function UpIcon(): ReactElement {
  // Folder-with-up-arrow: clearer than a bare ↑ which reads as "scroll".
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <polyline points="9 14 12 11 15 14" />
      <line x1="12" y1="11" x2="12" y2="17" />
    </svg>
  );
}

function RowActionMenu({
  menu,
  paneId,
  relDir,
  onClose,
  onView,
  onRename,
  onDelete
}: {
  menu: { item: FileListItem; anchor: { top: number; right: number } } | null;
  paneId: string;
  relDir: string;
  onClose: () => void;
  onView: (item: FileListItem) => void;
  onRename: (item: FileListItem) => void;
  onDelete: (item: FileListItem) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    const onDocPointer = (e: MouseEvent): void => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = (): void => onClose();
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, onClose]);
  if (!menu) return null;
  const { item, anchor } = menu;
  const childRel = relDir ? `${relDir}/${item.name}` : item.name;
  const downloadUrl =
    item.kind === "file"
      ? buildAuthedMediaUrl("/api/files/download", { paneId, rel: childRel })
      : null;
  return (
    <div
      ref={rootRef}
      role="menu"
      data-testid="file-panel-row-menu"
      style={{ position: "fixed", top: anchor.top, right: anchor.right }}
      className="z-30 min-w-[140px] overflow-hidden rounded-md border border-line bg-bg-elev text-[11px] text-ink shadow-lg"
    >
      <button
        type="button"
        role="menuitem"
        data-testid="file-panel-row-view"
        onClick={() => onView(item)}
        className="block w-full px-3 py-2 text-left hover:bg-bg-raised"
      >
        {t("files.view")}
      </button>
      {downloadUrl && (
        <a
          role="menuitem"
          data-testid="file-panel-row-download"
          href={downloadUrl}
          download={item.name}
          onClick={onClose}
          className="block w-full px-3 py-2 text-left hover:bg-bg-raised"
        >
          {t("files.download")}
        </a>
      )}
      <button
        type="button"
        role="menuitem"
        data-testid="file-panel-row-rename"
        onClick={() => onRename(item)}
        className="block w-full px-3 py-2 text-left hover:bg-bg-raised"
      >
        {t("files.rename")}
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="file-panel-row-delete"
        onClick={() => onDelete(item)}
        className="block w-full px-3 py-2 text-left text-err hover:bg-bg-raised"
      >
        {t("files.delete")}
      </button>
    </div>
  );
}

function RenameSheet({
  item,
  onClose,
  onSubmit
}: {
  item: FileListItem | null;
  onClose: () => void;
  onSubmit: (item: FileListItem, newName: string) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  useEffect(() => {
    if (item) setValue(item.name);
  }, [item]);
  if (!item) return null;
  const trimmed = value.trim();
  const invalid = trimmed === "" || trimmed === item.name || /[/\\]/.test(trimmed);
  return (
    <BottomSheet
      open={true}
      onClose={onClose}
      title={t("files.renameTitle", { name: item.name })}
      id="file-panel-rename-sheet"
    >
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) onSubmit(item, trimmed);
        }}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          data-testid="file-panel-rename-input"
          className="w-full rounded border border-line bg-bg px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line px-3 py-1.5 text-xs text-ink-dim hover:bg-bg-raised"
          >
            {t("files.cancel")}
          </button>
          <button
            type="submit"
            disabled={invalid}
            data-testid="file-panel-rename-submit"
            className="rounded bg-accent px-3 py-1.5 text-xs text-bg hover:bg-[#93cdff] disabled:opacity-40"
          >
            {t("files.save")}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}

function UploadIcon(): ReactElement {
  // Tray-with-arrow-out: distinct from the bare ⬆ glyph that reads as "go
  // up one directory" when it sits next to the breadcrumbs.
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function WrapTextIcon(): ReactElement {
  // The classic editor "word wrap" glyph: a full top line, a middle line
  // that bends back via a curved arrow, and a short third line.
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
      <polyline points="16 16 14 18 16 20" />
      <line x1="3" y1="18" x2="10" y2="18" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={spinning ? "animate-spin" : undefined}
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }): ReactElement {
  return open ? (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode
} from "react";
import { useTranslation } from "react-i18next";
import { useSessionsStore } from "../../stores/sessions-store.js";
import { useShellStateStore } from "../../stores/shell-state-store.js";
import { useComposeDraftStore } from "./compose-draft-store.js";
import { useComposeBridge } from "./compose-bridge.js";
import {
  rewriteWithAttachments,
  useAttachmentsStore,
  type ComposeAttachment
} from "./attachments-store.js";
import { ComposeAttachmentsRow } from "./ComposeAttachmentsRow.js";
import { useActivePane } from "./use-active-pane.js";
import { uploadFile, FilesApiError } from "../../services/files-api.js";
import { Suggestions } from "./completion/Suggestions.js";
import { useCompletion } from "./completion/use-completion.js";

export interface ComposeBarProps {
  onSend(text: string): void;
  keyOverlayOpen?: boolean;
  /**
   * Optional trailing toolbar slot rendered to the right of Send. Desktop-only
   * controls like the Direct Mode toggle live here so the TopBar stays lean.
   */
  trailingActions?: ReactNode;
}

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const ATTACHMENTS_DIR = ".tmp-msg-attachments";

// Stable reference so the zustand selector below doesn't return a fresh []
// on every call — which would trigger an infinite render loop because
// zustand's default equality is Object.is.
const EMPTY_ATTACHMENTS: ComposeAttachment[] = [];

export function ComposeBar({
  onSend,
  keyOverlayOpen = false,
  trailingActions
}: ComposeBarProps): ReactElement {
  const { t } = useTranslation();
  const attachedSession = useSessionsStore((s) => s.attachedSession);
  const baseSession = useSessionsStore((s) => s.attachedBaseSession);
  const shellState = useShellStateStore((s) => s.current.state);
  const paneCurrentCommand = useShellStateStore((s) => s.current.paneCurrentCommand);
  const draftFromStore = useComposeDraftStore((s) => s.drafts[attachedSession] ?? "");
  const setDraft = useComposeDraftStore((s) => s.setDraft);
  const clearDraft = useComposeDraftStore((s) => s.clearDraft);
  const registerFocus = useComposeBridge((s) => s.register);

  const attachments = useAttachmentsStore((s) => s.bySession[baseSession] ?? EMPTY_ATTACHMENTS);
  const addAttachment = useAttachmentsStore((s) => s.add);
  const updateAttachment = useAttachmentsStore((s) => s.update);
  const removeAttachment = useAttachmentsStore((s) => s.remove);
  const clearAttachments = useAttachmentsStore((s) => s.clear);

  const { paneId } = useActivePane();

  const [value, setValue] = useState(draftFromStore);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shellStateRef = useRef(shellState);
  shellStateRef.current = shellState;

  const completion = useCompletion({
    value,
    shellState,
    paneCurrentCommand,
    disabled: keyOverlayOpen
  });

  useEffect(() => {
    setValue(draftFromStore);
  }, [attachedSession, draftFromStore]);

  // Auto-grow the textarea in response to content. Capped at 240px (more
  // generous than the old 160px because compose now floats above the shell
  // rather than pushing it — so vertical growth is cheap).
  const resize = useCallback((): void => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [resize, value, attachments.length]);

  useEffect(() => {
    const unregister = registerFocus((prefill) => {
      const el = textareaRef.current;
      if (!el) return;
      if (prefill !== undefined) {
        setValue(prefill);
        queueMicrotask(() => {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        });
      } else {
        el.focus();
      }
    });
    return unregister;
  }, [registerFocus]);

  const attachFiles = useCallback(
    (files: File[]): void => {
      if (!paneId) {
        // No pane → no cwd → nowhere to upload. Silently ignore.
        return;
      }
      for (const file of files) {
        const id = randomId();
        const abort = new AbortController();
        const thumbnailUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        const entry: ComposeAttachment = {
          id,
          name: file.name || "pasted",
          size: file.size,
          mime: file.type || "application/octet-stream",
          status: "uploading",
          progress: 0,
          abort,
          thumbnailUrl
        };
        addAttachment(baseSession, entry);

        uploadFile(file, {
          paneId,
          relDir: ATTACHMENTS_DIR,
          stamp: true,
          onProgress: (fraction) => updateAttachment(baseSession, id, { progress: fraction }),
          signal: abort.signal
        })
          .then((result) => {
            const written = result.written[0];
            if (!written) {
              updateAttachment(baseSession, id, {
                status: "error",
                error: "no result"
              });
              return;
            }
            updateAttachment(baseSession, id, {
              status: "done",
              progress: 1,
              rel: written.rel
            });
          })
          .catch((error: unknown) => {
            const message =
              error instanceof FilesApiError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : String(error);
            updateAttachment(baseSession, id, {
              status: "error",
              error: message
            });
          });
      }
    },
    [addAttachment, baseSession, paneId, updateAttachment]
  );

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value;
    setValue(next);
    if (shellStateRef.current !== "password_prompt" && attachedSession) {
      setDraft(attachedSession, next);
    }
  };

  const hasUploadsInFlight = attachments.some((a) => a.status === "uploading");
  const hasErrors = attachments.some((a) => a.status === "error");

  const handleSend = useCallback((): void => {
    if (hasUploadsInFlight) return;
    const text = rewriteWithAttachments(value, attachments);
    if (!text.trim()) return;
    onSend(text);
    setValue("");
    if (attachedSession) clearDraft(attachedSession);
    if (baseSession) clearAttachments(baseSession);
  }, [
    attachments,
    attachedSession,
    baseSession,
    clearAttachments,
    clearDraft,
    hasUploadsInFlight,
    onSend,
    value
  ]);

  const pickCompletionEntry = useCallback(
    (entry: { insert: string }): void => {
      setValue(entry.insert);
      if (shellStateRef.current !== "password_prompt" && attachedSession) {
        setDraft(attachedSession, entry.insert);
      }
      completion.dismiss("pick");
      queueMicrotask(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      });
    },
    [attachedSession, completion, setDraft]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (completion.active) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        completion.moveHighlight(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        completion.moveHighlight(-1);
        return;
      }
      // Tab always accepts the highlighted suggestion — mirrors fish
      // autosuggestions and zsh-autosuggestions' right-arrow accept.
      if (e.key === "Tab") {
        e.preventDefault();
        const picked = completion.entries[completion.highlightIndex];
        if (picked) pickCompletionEntry(picked);
        return;
      }
      // Sigil-triggered popovers (`/`, `:`) are intentional — the user typed
      // a command-palette character. Enter in that mode picks. For bare
      // triggers (user is typing a plain shell command like `ls`) Enter
      // must keep its normal "send" semantics; the suggestion strip is a
      // non-blocking hint.
      if (
        completion.trigger !== "bare" &&
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.nativeEvent.isComposing
      ) {
        e.preventDefault();
        const picked = completion.entries[completion.highlightIndex];
        if (picked) pickCompletionEntry(picked);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        completion.dismiss("esc");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      attachFiles(files);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    attachFiles(Array.from(files));
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    // Only clear when leaving the outer container, not when moving between
    // inner children (e.g., hovering the chip row).
    if (e.currentTarget === e.target) setDragOver(false);
  };

  const handleAttachClick = (): void => fileInputRef.current?.click();

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) {
      attachFiles(Array.from(files));
    }
    e.target.value = "";
  };

  const floating = attachments.length > 0;

  return (
    <div
      data-floating={floating ? "1" : "0"}
      data-testid="compose-bar"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`tm-compose-wrap grid grid-cols-[auto_1fr_auto_auto] items-end gap-1.5 border-t border-line bg-bg-elev/95 px-2.5 pt-2 pb-2.5 ${
        floating ? "shadow-lg backdrop-blur-sm" : ""
      } ${dragOver ? "ring-2 ring-accent/60 ring-inset" : ""}`}
    >
      {completion.active && (
        <Suggestions
          entries={completion.entries}
          highlightIndex={completion.highlightIndex}
          onPick={pickCompletionEntry}
          onHighlight={completion.setHighlight}
          onDismiss={completion.dismiss}
        />
      )}
      <ComposeAttachmentsRow
        attachments={attachments}
        onRemove={(id) => removeAttachment(baseSession, id)}
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
      <button
        type="button"
        onClick={handleAttachClick}
        aria-label={t("compose.attachLabel")}
        title={t("compose.attachTitle")}
        disabled={!paneId}
        className="h-10 rounded-lg border border-line-strong bg-bg-raised px-2.5 text-base text-ink hover:bg-bg-elev active:bg-bg disabled:opacity-40"
      >
        📎
      </button>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        rows={1}
        placeholder={t("compose.placeholder")}
        className="min-h-10 max-h-60 w-full resize-none rounded-lg border border-line-strong bg-bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-mute focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
        style={{ touchAction: "pan-y" }}
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={(!value.trim() && attachments.length === 0) || hasUploadsInFlight || hasErrors}
        title={
          hasUploadsInFlight
            ? t("compose.waitingUpload")
            : hasErrors
              ? t("compose.attachmentErrors")
              : undefined
        }
        className="h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-bg hover:bg-[#93cdff] active:bg-[#5faae8] disabled:bg-line-strong disabled:text-ink-mute"
      >
        {hasUploadsInFlight ? "…" : t("compose.sendButton")}
      </button>
      {trailingActions ?? <span className="hidden" />}
    </div>
  );
}

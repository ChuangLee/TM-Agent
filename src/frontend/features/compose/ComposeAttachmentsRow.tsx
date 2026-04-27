import type { ReactElement } from "react";
import type { ComposeAttachment } from "./attachments-store.js";

export interface ComposeAttachmentsRowProps {
  attachments: ComposeAttachment[];
  onRemove(id: string): void;
}

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export function ComposeAttachmentsRow({
  attachments,
  onRemove
}: ComposeAttachmentsRowProps): ReactElement | null {
  if (attachments.length === 0) return null;
  return (
    <div data-testid="compose-attachments" className="col-span-4 flex flex-wrap gap-1.5 px-0.5">
      {attachments.map((a) => (
        <AttachmentChip key={a.id} attachment={a} onRemove={() => onRemove(a.id)} />
      ))}
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove
}: {
  attachment: ComposeAttachment;
  onRemove(): void;
}): ReactElement {
  const ring =
    attachment.status === "error"
      ? "border-err"
      : attachment.status === "uploading"
        ? "border-accent/50"
        : "border-line-strong";
  return (
    <div
      data-testid="compose-attachment-chip"
      data-status={attachment.status}
      className={`flex max-w-[220px] items-center gap-1.5 rounded-md border ${ring} bg-bg-raised px-1.5 py-1 text-xs text-ink`}
    >
      {attachment.thumbnailUrl ? (
        <img
          src={attachment.thumbnailUrl}
          alt=""
          className="h-6 w-6 shrink-0 rounded object-cover"
        />
      ) : (
        <span aria-hidden="true" className="text-base leading-none">
          {attachment.mime.startsWith("image/")
            ? "🖼"
            : attachment.mime.includes("pdf")
              ? "📄"
              : attachment.mime.startsWith("video/")
                ? "🎬"
                : attachment.mime.startsWith("audio/")
                  ? "🎵"
                  : "📎"}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span title={attachment.name} className="truncate font-mono text-[11px] text-ink">
          {attachment.name}
        </span>
        <span className="text-[10px] text-ink-mute">
          {attachment.status === "uploading"
            ? `${Math.round(attachment.progress * 100)}%`
            : attachment.status === "error"
              ? (attachment.error ?? "failed")
              : formatBytes(attachment.size)}
        </span>
      </div>
      <button
        type="button"
        aria-label={`Remove ${attachment.name}`}
        onClick={onRemove}
        className="flex h-5 w-5 items-center justify-center rounded text-ink-mute hover:bg-bg-elev hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}

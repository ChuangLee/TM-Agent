import { create } from "zustand";
import i18n from "../../i18n/index.js";

export type AttachmentStatus = "uploading" | "done" | "error";

export interface ComposeAttachment {
  /** Client-side id (uuid-like). Stable across status changes. */
  id: string;
  /** Original filename from the user (not sanitized). */
  name: string;
  size: number;
  mime: string;
  status: AttachmentStatus;
  /** 0..1 upload progress. */
  progress: number;
  /** Server-assigned relative path (e.g. `.tmp-msg-attachments/<ts>-<name>.png`). */
  rel?: string;
  /** Present when `mime` starts with `image/`. Revoke on remove. */
  thumbnailUrl?: string;
  /** Human-readable error when status === "error". */
  error?: string;
  /** Used to cancel in-flight upload. */
  abort?: AbortController;
}

interface AttachmentsState {
  /** keyed by sessionId (usually base session name). */
  bySession: Record<string, ComposeAttachment[]>;
  /**
   * Add a freshly-staged attachment to the given session. Callers are
   * expected to kick off the upload separately and then update status via
   * `setStatus` + `setProgress`.
   */
  add(sessionId: string, att: ComposeAttachment): void;
  update(sessionId: string, id: string, patch: Partial<ComposeAttachment>): void;
  remove(sessionId: string, id: string): void;
  clear(sessionId: string): void;
  get(sessionId: string): ComposeAttachment[];
}

export const useAttachmentsStore = create<AttachmentsState>((set, getState) => ({
  bySession: {},
  add(sessionId, att) {
    set((s) => {
      const cur = s.bySession[sessionId] ?? [];
      return { bySession: { ...s.bySession, [sessionId]: [...cur, att] } };
    });
  },
  update(sessionId, id, patch) {
    set((s) => {
      const cur = s.bySession[sessionId];
      if (!cur) return s;
      const next = cur.map((a) => (a.id === id ? { ...a, ...patch } : a));
      return { bySession: { ...s.bySession, [sessionId]: next } };
    });
  },
  remove(sessionId, id) {
    set((s) => {
      const cur = s.bySession[sessionId];
      if (!cur) return s;
      const target = cur.find((a) => a.id === id);
      if (target?.thumbnailUrl) {
        URL.revokeObjectURL(target.thumbnailUrl);
      }
      if (target?.abort) target.abort.abort();
      const next = cur.filter((a) => a.id !== id);
      return { bySession: { ...s.bySession, [sessionId]: next } };
    });
  },
  clear(sessionId) {
    set((s) => {
      const cur = s.bySession[sessionId];
      if (cur) {
        for (const att of cur) {
          if (att.thumbnailUrl) URL.revokeObjectURL(att.thumbnailUrl);
        }
      }
      const { [sessionId]: _removed, ...rest } = s.bySession;
      void _removed;
      return { bySession: rest };
    });
  },
  get(sessionId) {
    return getState().bySession[sessionId] ?? [];
  }
}));

// Marker line sent to the agent before attachment paths. Localized so an
// English-speaking user sees an English marker in the prompt the LLM reads.
// Resolved lazily (each call) so i18next picks up language changes.
export const getAttachmentPrefix = (): string => i18n.t("compose.attachmentPrefix");

/**
 * Rewrite outgoing compose text to include attachment paths. Agents in the
 * shell read this as plain text so the format must be both human-skimmable
 * and easy to regex for — a leading marker line plus 2-space-indented paths.
 *
 * Single attachment → `  ./<rel>`.
 * Multiple attachments → `  file1: ./<rel>` / `  file2: ./<rel>` / ... so
 * an agent summarizing the message never conflates which blob is which.
 *
 * The leading `./` is load-bearing: it signals "this path is relative to
 * the shell's cwd, not a repo root or /home lookup". Agents tend to respect
 * the dot where they'd otherwise guess.
 *
 * Empty attachment array → return text unchanged (no trailing newline).
 */
export function rewriteWithAttachments(userText: string, attachments: ComposeAttachment[]): string {
  const ready = attachments.filter((a) => a.status === "done" && a.rel).map((a) => a.rel as string);
  if (ready.length === 0) return userText;
  const withDot = (rel: string): string =>
    rel.startsWith("./") || rel.startsWith("/") ? rel : `./${rel}`;
  const lines =
    ready.length === 1
      ? `  ${withDot(ready[0]!)}`
      : ready.map((rel, i) => `  file${i + 1}: ${withDot(rel)}`).join("\n");
  const trimmed = userText.replace(/\s+$/, "");
  const prefix = trimmed ? `${trimmed}\n\n` : "";
  return `${prefix}${getAttachmentPrefix()}\n${lines}`;
}

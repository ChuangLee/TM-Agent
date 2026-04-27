import { useMemo } from "react";
import { selectAttachedBaseState, useSessionsStore } from "../../stores/sessions-store.js";
import { useLayoutStore } from "../../stores/layout-store.js";
import type { TmuxPaneState, TmuxStateSnapshot } from "../../../shared/protocol.js";

export interface ActivePaneInfo {
  /** tmux pane id like `%42`. Empty when no pane yet. */
  paneId: string;
  /** `#{pane_current_path}` of that pane. Empty when unresolved. */
  currentPath: string;
}

const resolvePane = (snapshot: TmuxStateSnapshot | null, baseName: string): ActivePaneInfo => {
  const base = selectAttachedBaseState(snapshot, baseName);
  const activeWindow = base?.windowStates.find((w) => w.active) ?? base?.windowStates[0];
  const activePane: TmuxPaneState | undefined =
    activeWindow?.panes.find((p) => p.active) ?? activeWindow?.panes[0];
  return {
    paneId: activePane?.id ?? "",
    currentPath: activePane?.currentPath ?? ""
  };
};

/**
 * Derive the focused slot's active pane. FilePanel root, compose attachments,
 * and anything else "what is the user looking at right now" track this. In
 * multi-slot layouts the focused slot drives the answer; in single-mode this
 * collapses to slot 0 (the only slot).
 */
export function useActivePane(): ActivePaneInfo {
  const snapshot = useSessionsStore((s) => s.snapshot);
  // Fall back to the legacy single-slot field when slot store has no
  // attachment yet (very early after auth, before the `attached` message).
  const legacyBase = useSessionsStore((s) => s.attachedBaseSession);
  const baseName = useLayoutStore((s) => {
    const focused = s.slots.find((slot) => slot.id === s.focusedSlot);
    return focused?.attachedSession ?? "";
  });
  const effective = baseName || legacyBase;
  return useMemo(() => resolvePane(snapshot, effective), [snapshot, effective]);
}

/**
 * Same shape as useActivePane but for an arbitrary slot — used by prefetch
 * paths that warm caches for non-focused slots.
 */
export function selectSlotActivePane(
  snapshot: TmuxStateSnapshot | null,
  slotBaseName: string | null
): ActivePaneInfo {
  return resolvePane(snapshot, slotBaseName ?? "");
}

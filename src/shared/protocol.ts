/**
 * Slot id (ADR-0013): position-based identity for desktop multi-pane tiling.
 * 0 = top-left, 1 = top-right, 2 = bottom-left, 3 = bottom-right.
 * Wire-level type intentionally `number` (not literal 0|1|2|3) for forward
 * compat — clients may roll out new slot ids before the server understands
 * them. Backend defaults missing slot to 0 (single-pane behaviour).
 */
export type WireSlotId = number;

/**
 * ADR-0015 §2: optional feature flags negotiated at auth time. Absent = client
 * is an older build and the server must fall back to pre-ADR-0015 behaviour.
 *
 * - `stateDelta`: client understands `tmux_state_delta` messages and will
 *   send `resync_state` when it detects a version gap. When false/absent,
 *   server only sends full `tmux_state` broadcasts.
 */
export interface ClientCapabilities {
  stateDelta?: boolean;
}

export type ControlClientMessage =
  | {
      type: "auth";
      token?: string;
      password?: string;
      clientId?: string;
      capabilities?: ClientCapabilities;
    }
  | { type: "resync_state" }
  | { type: "terminal_ready"; cols: number; rows: number; slot?: WireSlotId }
  | { type: "select_session"; session: string; slot?: WireSlotId }
  | {
      type: "new_session";
      name: string;
      slot?: WireSlotId;
      cwd?: string;
      startupCommand?: string;
    }
  | { type: "rename_session"; session: string; newName: string }
  | { type: "kill_session"; session: string }
  | { type: "new_window"; session: string }
  | { type: "select_window"; session: string; windowIndex: number; stickyZoom?: boolean }
  | { type: "kill_window"; session: string; windowIndex: number }
  | {
      type: "rename_window";
      session: string;
      windowIndex: number;
      newName: string;
    }
  | { type: "select_pane"; paneId: string; stickyZoom?: boolean }
  | { type: "split_pane"; paneId: string; orientation: "h" | "v" }
  | { type: "kill_pane"; paneId: string }
  | { type: "zoom_pane"; paneId: string }
  | {
      type: "capture_scrollback";
      paneId: string;
      lines?: number;
      includeEscapes?: boolean;
    }
  | { type: "send_compose"; text: string; slot?: WireSlotId }
  | { type: "send_raw"; bytes: string; slot?: WireSlotId }
  | { type: "detach_slot"; slot: WireSlotId };

export interface TmuxSessionSummary {
  name: string;
  attached: boolean;
  windows: number;
  /** Unix seconds of `#{session_activity}` — last time any pane in the session produced output. */
  lastActivity?: number;
}

export interface TmuxPaneState {
  index: number;
  id: string;
  currentCommand: string;
  active: boolean;
  width: number;
  height: number;
  zoomed: boolean;
  /**
   * Absolute path of the shell process's cwd. Empty string when tmux can't
   * resolve it (dead pane, early window life). Feeds ADR-0012 FilePanel +
   * ComposeBar attachments — **load-bearing** for the file panel's root.
   */
  currentPath: string;
}

export interface TmuxWindowState {
  index: number;
  name: string;
  active: boolean;
  paneCount: number;
  panes: TmuxPaneState[];
}

export interface TmuxSessionState extends TmuxSessionSummary {
  windowStates: TmuxWindowState[];
}

export interface TmuxStateSnapshot {
  sessions: TmuxSessionState[];
  capturedAt: string;
}

export interface SystemStatsSample {
  /** Unix ms when the sample was taken. */
  t: number;
  /** CPU busy fraction, 0..1, averaged across all cores since the previous sample. */
  cpu: number;
  /** Memory used fraction, 0..1. Uses MemAvailable when present, else falls back to total − (free+buffers+cached). */
  mem: number;
  /** Raw 1-minute load average. */
  load1: number;
  /** Logical CPU count — used by the client to normalize load. */
  cores: number;
  /** Seconds since boot. */
  uptimeSec: number;
}

/**
 * ADR-0015 §2: RFC 6902 JSON Patch operation set used for `tmux_state_delta`.
 * We deliberately restrict to add/replace/remove — move/copy/test are never
 * emitted by the backend diff path and keeping the set narrow simplifies
 * the frontend applier's error handling.
 */
export type TmuxStatePatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

export type ControlServerMessage =
  | { type: "auth_ok"; clientId: string; requiresPassword: boolean }
  | { type: "auth_error"; reason: string }
  | { type: "attached"; session: string; baseSession: string; slot?: WireSlotId }
  | { type: "session_picker"; sessions: TmuxSessionSummary[] }
  /**
   * Full snapshot. `version` is populated for delta-capable clients and
   * resets the client's applied-version counter to this value. Older clients
   * (no `stateDelta` capability) receive this message with `version` omitted.
   */
  | { type: "tmux_state"; state: TmuxStateSnapshot; version?: number }
  /**
   * Incremental snapshot. Apply `patch` atop the client's current snapshot
   * (last `tmux_state` or `tmux_state_delta` that set version = baseVersion)
   * to obtain the new snapshot at `version`. On version mismatch, the client
   * drops the delta and sends `resync_state` to force the server to resend
   * a full `tmux_state`.
   */
  | {
      type: "tmux_state_delta";
      version: number;
      baseVersion: number;
      capturedAt: string;
      patch: { ops: TmuxStatePatchOp[] };
    }
  | {
      type: "scrollback";
      paneId: string;
      text: string;
      lines: number;
      slot?: WireSlotId;
    }
  | { type: "system_stats"; sample?: SystemStatsSample; unsupported?: boolean }
  | { type: "error"; message: string }
  | { type: "info"; message: string };

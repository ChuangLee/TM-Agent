import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { ControlClientMessage } from "../../../shared/protocol.js";
import { Surface } from "./Surface.js";
import { useLayoutStore, type SlotId } from "../../stores/layout-store.js";
import { useTerminalStore, selectSlotSwitchPending } from "../../stores/terminal-store.js";
import { selectBaseSessions, useSessionsStore } from "../../stores/sessions-store.js";
import { useSheetStore } from "../../stores/sheet-store.js";
import { useConnectionStore } from "../../stores/connection-store.js";

/**
 * VS-Code-style threshold: if a switch completes in < SWITCH_PROGRESS_DELAY ms
 * we never show the progress strip — a flashing bar at that duration reads as
 * jank, not loading. Above it, we surface a thin YouTube-style strip at the
 * top of the slot so the user knows something's in flight and the (still
 * visible) old frame is stale, not frozen.
 */
const SWITCH_PROGRESS_DELAY_MS = 150;

export interface SlotFrameProps {
  slotId: SlotId;
  send: (message: ControlClientMessage) => void;
}

/**
 * Wraps Surface for one slot. Owns the per-slot mini-bar (close button,
 * session label) and dispatches the slot's `select_session` whenever its
 * attachedSession changes — *after* `terminal_ready` has been emitted, so
 * backend has dims before it spawns the runtime. Single-mode slot 0 keeps
 * the legacy auto-attach path (handleReady doesn't dispatch select_session
 * because backend's ensureAttachedSession picks for us).
 */
export function SlotFrame({ slotId, send }: SlotFrameProps): ReactElement {
  const mode = useLayoutStore((s) => s.mode);
  // Single-mode has only one slot, so highlighting "the focused one" carries
  // zero information — kill the accent ring + Direct Mode breathing glow by
  // never reporting focused=true to CSS in mode 1.
  const focused = useLayoutStore((s) => s.mode > 1 && s.focusedSlot === slotId);
  const setFocus = useLayoutStore((s) => s.setFocus);
  const detachSlot = useLayoutStore((s) => s.detachSlot);
  const attachedSession = useLayoutStore(
    (s) => s.slots.find((slot) => slot.id === slotId)?.attachedSession ?? null
  );

  const useExplicitAttach = !(mode === 1 && slotId === 0);
  const [ready, setReady] = useState(false);
  const switchPending = useTerminalStore(selectSlotSwitchPending(slotId));
  const connectionStatus = useConnectionStore((s) => s.status);
  const reconnecting = connectionStatus.kind === "connecting" || connectionStatus.kind === "closed";
  // Delay the visible progress strip so fast switches stay chrome-free.
  const [showProgress, setShowProgress] = useState(false);
  useEffect(() => {
    if (!switchPending && !reconnecting) {
      setShowProgress(false);
      return;
    }
    const id = window.setTimeout(() => setShowProgress(true), SWITCH_PROGRESS_DELAY_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [switchPending, reconnecting]);
  const lastDispatchedRef = useRef<string | null>(null);
  const lastDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  // First terminal_ready of this mount. If attachedSession is already set at
  // that point (mode-change remount), backend's runtime is live but the new
  // xterm is empty; a plain resize leaves it black until tmux emits output.
  // Force a select_session so attachControlToBaseSession re-seeds via
  // capture-pane and the fresh xterm fills immediately.
  const firstReadyHandledRef = useRef(false);
  // Bumps on every successful auth (initial + reconnect). When the backend
  // is fresh it has no record of our slot's terminal_ready/select_session,
  // so we must drop dedup state and let Surface remount to re-issue the
  // handshake. Without this, reconnect leaves the slot stuck on "ready" with
  // a memoized lastDispatchedRef and the user sees a 30+ second hang until
  // some unrelated resize wakes things up.
  const authEpoch = useConnectionStore((s) => s.authEpoch);
  useEffect(() => {
    if (authEpoch === 0) return;
    lastDispatchedRef.current = null;
    lastDimsRef.current = null;
    firstReadyHandledRef.current = false;
    setReady(false);
  }, [authEpoch]);

  const handleReady = useCallback(
    (cols: number, rows: number) => {
      // Dedup: Surface fires onReady on every applyResize() and once
      // unconditionally in start(). If layout settles over multiple frames
      // (which it can during initial mount) we'd otherwise spam the
      // control-WS with identical terminal_ready messages and queue up
      // backend resize work. Only dispatch when dims actually change.
      const last = lastDimsRef.current;
      const duplicate = last && last.cols === cols && last.rows === rows;
      if (!duplicate) {
        lastDimsRef.current = { cols, rows };
        send({ type: "terminal_ready", slot: slotId, cols, rows });
      }
      if (!firstReadyHandledRef.current) {
        firstReadyHandledRef.current = true;
        // Remount path: attachedSession already known at first ready → backend
        // runtime is live but xterm is fresh. Force re-attach so the backend
        // re-seeds scrollback (capture-pane via attachControlToBaseSession).
        // Skips single-mode bootstrap where attachedSession is null — that
        // flow relies on backend's auto-pick and sends `attached` on its own.
        const currentAttached =
          useLayoutStore.getState().slots.find((s) => s.id === slotId)?.attachedSession ?? null;
        if (currentAttached) {
          useTerminalStore.getState().beginSessionSwitch(slotId);
          send({
            type: "select_session",
            slot: slotId,
            session: currentAttached
          });
          lastDispatchedRef.current = currentAttached;
        }
      }
      if (!ready) setReady(true);
    },
    [send, slotId, ready]
  );

  useEffect(() => {
    if (!attachedSession || !ready) return;
    if (lastDispatchedRef.current === attachedSession) return;
    // Single-mode slot 0: backend auto-attaches; we just sync the ref so a
    // future mode-switch into multi doesn't trigger a needless re-attach.
    if (useExplicitAttach) {
      useTerminalStore.getState().beginSessionSwitch(slotId);
      send({ type: "select_session", slot: slotId, session: attachedSession });
    }
    lastDispatchedRef.current = attachedSession;
  }, [attachedSession, ready, slotId, send, useExplicitAttach]);

  const handleClose = useCallback(() => {
    // ADR-0013 §5: close + auto-collapse + repack survivors. closeSlot returns
    // the backend slots that need a `detach_slot` (the closed one + any
    // survivor whose layout position shifted). Survivors at their NEW
    // position re-attach via SlotFrame's effect once Surface remounts.
    const result = useLayoutStore.getState().closeSlot(slotId);
    for (const vacated of result.vacatedSlots) {
      send({ type: "detach_slot", slot: vacated });
    }
    lastDispatchedRef.current = null;
    void detachSlot; // kept for back-compat callers
  }, [send, detachSlot, slotId]);

  const handleClick = useCallback(() => {
    setFocus(slotId);
  }, [setFocus, slotId]);

  // Empty slot in multi-mode: show picker. Single-mode slot 0 always renders
  // Surface (legacy bootstrap).
  if (!attachedSession && useExplicitAttach) {
    return (
      <div
        className="slot-frame"
        data-slot={slotId}
        data-focused={focused}
        data-testid={`slot-frame-${slotId}`}
        onClick={handleClick}
      >
        {mode > 1 && <SlotMiniBar slotId={slotId} label="empty" onClose={handleClose} />}
        <EmptySlotPicker slotId={slotId} send={send} />
      </div>
    );
  }

  return (
    <div
      className="slot-frame"
      data-slot={slotId}
      data-focused={focused}
      data-testid={`slot-frame-${slotId}`}
      onClick={handleClick}
    >
      {mode > 1 && (
        <SlotMiniBar
          slotId={slotId}
          label={attachedSession ?? "(attaching…)"}
          onClose={handleClose}
        />
      )}
      <div
        className="relative min-h-0 flex-1"
        data-switching={switchPending || reconnecting ? "true" : "false"}
        data-reconnecting={reconnecting ? "true" : "false"}
      >
        {/* Surface key includes authEpoch so a reconnect remounts xterm and
            triggers a fresh onReady → terminal_ready handshake. The DOM
            row recycle inside Surface is cheap; the alternative (manually
            re-dispatching after reset) races with applyResize cycles. */}
        <Surface key={`slot-${slotId}-${authEpoch}`} slotId={slotId} onReady={handleReady} />
        {/* YouTube-style thin progress strip at the top of the slot, only
            surfaced after SWITCH_PROGRESS_DELAY_MS so fast round-trips stay
            chrome-free. iTerm2-style: keep the last frame visible, dim it
            slightly; never blank the pane. */}
        {showProgress && (
          <div
            className="slot-frame-progress"
            data-testid={`slot-frame-${slotId}-progress`}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

interface SlotMiniBarProps {
  slotId: SlotId;
  label: string;
  onClose: (() => void) | null;
}

function SlotMiniBar({ slotId, label, onClose }: SlotMiniBarProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="slot-mini-bar">
      <span className="slot-mini-bar-name" title={label}>
        {label}
      </span>
      {onClose && (
        <button
          type="button"
          className="slot-mini-bar-close"
          aria-label={t("slot.closeAria", { slot: slotId })}
          data-testid={`slot-frame-${slotId}-close`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

interface EmptySlotPickerProps {
  slotId: SlotId;
  send: (message: ControlClientMessage) => void;
}

/**
 * Polished empty-slot picker (ADR-0013 §4):
 * - Large "+ New session" CTA at top (opens the existing New Session sheet,
 *   tagged with this slot so the created session attaches here).
 * - Below it, a list of existing base sessions. Sessions already attached
 *   to other slots are rendered disabled with a tooltip naming the slot.
 */
function EmptySlotPicker({ slotId, send }: EmptySlotPickerProps): ReactElement {
  const { t } = useTranslation();
  const snapshot = useSessionsStore((s) => s.snapshot);
  const attachToSlot = useLayoutStore((s) => s.attachToSlot);
  const layoutSlots = useLayoutStore((s) => s.slots);
  const openSheet = useSheetStore((s) => s.open);
  const baseSessions = selectBaseSessions(snapshot);

  // Map session name → slotId where it's currently attached (excluding self).
  const attachedElsewhere = new Map<string, number>();
  for (const slot of layoutSlots) {
    if (slot.id === slotId) continue;
    if (slot.attachedSession) {
      attachedElsewhere.set(slot.attachedSession, slot.id);
    }
  }

  const handlePick = useCallback(
    (session: string) => {
      attachToSlot(slotId, session);
      useTerminalStore.getState().beginSessionSwitch(slotId);
      void send;
    },
    [attachToSlot, slotId, send]
  );

  const handleNewSession = useCallback(() => {
    openSheet({ kind: "new-session", slot: slotId });
  }, [openSheet, slotId]);

  return (
    <div className="slot-empty" data-testid={`slot-frame-${slotId}-empty`}>
      <button
        type="button"
        data-testid={`slot-frame-${slotId}-new-session`}
        onClick={(e) => {
          e.stopPropagation();
          handleNewSession();
        }}
        className="rounded-lg border-2 border-dashed border-line-strong bg-bg-elev px-4 py-6 text-center text-sm font-semibold text-ink hover:border-accent hover:bg-bg-elev-hi"
      >
        {t("slot.newSession")}
      </button>
      <p className="slot-empty-title">{t("slot.attachExisting")}</p>
      {baseSessions.length === 0 ? (
        <p className="text-xs text-ink-mute" data-testid={`slot-frame-${slotId}-empty-none`}>
          {t("slot.noneAttachable")}
        </p>
      ) : (
        <div className="slot-empty-list">
          {baseSessions.map((s) => {
            const occupiedBy = attachedElsewhere.get(s.name);
            const disabled = occupiedBy !== undefined;
            return (
              <button
                key={s.name}
                type="button"
                disabled={disabled}
                data-testid={`slot-frame-${slotId}-pick-${s.name}`}
                data-disabled={disabled}
                title={disabled ? t("slot.occupied", { slot: occupiedBy }) : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (disabled) return;
                  handlePick(s.name);
                }}
              >
                <span>{s.name}</span>
                <span className="slot-empty-list-meta">
                  {disabled
                    ? t("slot.occupiedShort", { slot: occupiedBy })
                    : t(s.windowStates.length === 1 ? "slot.windowsOne" : "slot.windowsOther", {
                        count: s.windowStates.length
                      })}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

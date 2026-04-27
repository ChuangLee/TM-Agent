import { useEffect, useRef, useState, type RefObject } from "react";
import { Terminal, type IBufferLine } from "@xterm/xterm";
import { measureCellMetrics } from "../../lib/cell-metrics.js";
import { debugLog } from "../../lib/debug-log.js";
import { TerminalWsClient } from "../../services/terminal-ws.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useTerminalStore } from "../../stores/terminal-store.js";
import type { SlotId } from "../../stores/layout-store.js";
import { DomRenderer } from "./dom-renderer.js";

const SEED_WAIT_MS = 1500;
const STICK_TOLERANCE_ROWS = 2;

export interface TerminalHandles {
  terminal: Terminal | null;
  isAltScreen: boolean;
}

export interface UseTerminalArgs {
  scrollerRef: RefObject<HTMLDivElement | null>;
  spacerRef: RefObject<HTMLDivElement | null>;
  rowsRef: RefObject<HTMLDivElement | null>;
  cursorRef: RefObject<HTMLDivElement | null>;
  /**
   * Invoked after every settled cell measurement with the frontend's real
   * cols/rows. The backend gates tmux attach + capture-pane on the first
   * call; subsequent calls are forwarded as pty resizes (the control channel
   * is authoritative here because `terminal-ws` may not be open yet when the
   * grid settles, which silently drops resize frames).
   */
  onReady?: (cols: number, rows: number) => void;
  /**
   * ADR-0013 slot id. Single-mode (no layout switching) uses slot 0; PR #3+
   * mounts multiple `Surface` components, each on their own slot. The slot
   * scopes which terminal-store slice this hook reads (seed, switch gate)
   * so independent slots don't trigger each other's resets.
   */
  slotId: SlotId;
}

/**
 * Owns the headless xterm.js instance (ADR-0005). xterm parses PTY bytes into
 * a buffer; the DOM rendering, cursor, scroll, and cell sizing are ours.
 *
 * We deliberately do NOT call `term.open()` — xterm holds no DOM. `onRender`
 * therefore does not fire; we subscribe to `onWriteParsed`, `onScroll`,
 * `onCursorMove`, and `buffer.onBufferChange` instead, coalescing everything
 * into a single rAF-throttled `DomRenderer.update()`.
 */
export function useTerminal(args: UseTerminalArgs): TerminalHandles {
  const { scrollerRef, spacerRef, rowsRef, cursorRef, onReady, slotId } = args;
  const token = useAuthStore((s) => s.token);
  const password = useAuthStore((s) => s.password);
  const clientId = useAuthStore((s) => s.clientId);
  const clearSeed = useTerminalStore((s) => s.clearSeed);
  const [isAltScreen, setIsAltScreen] = useState(false);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!clientId) return;
    const scroller = scrollerRef.current;
    const spacer = spacerRef.current;
    const rowsEl = rowsRef.current;
    const cursorEl = cursorRef.current;
    if (!scroller || !spacer || !rowsEl || !cursorEl) return;

    // Initial measurement may run before the custom monospace font has
    // finished loading — the fallback font's glyph advance is slightly
    // different, so cols = clientWidth / cellW drifts by a few columns
    // until fonts settle. We re-measure once `document.fonts.ready`
    // resolves and trigger a refit if the advance changed.
    const initialMetrics = measureCellMetrics();
    let cellW = initialMetrics.cellWidthPx;
    const cellH = initialMetrics.lineHeightPx;

    const initialCols = Math.max(10, Math.floor(scroller.clientWidth / cellW));
    const initialRows = Math.max(5, Math.floor(scroller.clientHeight / cellH));

    debugLog("terminal", "mount", {
      clientW: scroller.clientWidth,
      clientH: scroller.clientHeight,
      cellW,
      cellH,
      initialCols,
      initialRows,
      dpr: typeof window !== "undefined" ? window.devicePixelRatio : null
    });

    const term = new Terminal({
      cols: initialCols,
      rows: initialRows,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true
    });
    // NOTE: no term.open() — xterm runs headless; we render from buffer.active.
    terminalRef.current = term;
    // Publish through React state too so consumers (useShellState, ActionPanel)
    // re-render once the instance exists. Refs alone don't trigger re-renders.
    setTerminal(term);

    let altScreen = false;
    let suppressUserDetection = false;
    let rafPending = false;
    let disposed = false;
    let wasAtBottom = true;

    const getTopLine = (): number => {
      if (altScreen) return 0;
      return Math.max(0, Math.floor(scroller.scrollTop / cellH));
    };

    const getVisibleRows = (): number => term.rows;

    const renderer = new DomRenderer({
      rows: rowsEl,
      cursor: cursorEl,
      cellWidthPx: cellW,
      cellHeightPx: cellH,
      getWindow: () => {
        const topLine = getTopLine();
        const bufferLength = term.buffer.active.length;
        const visibleRows = getVisibleRows();
        const cur = term.buffer.active;
        return {
          topLine,
          visibleRows,
          cols: term.cols,
          bufferLength,
          cursor: {
            x: cur.cursorX,
            // cursorY is relative to the buffer's baseY (top of live window).
            y: cur.baseY + cur.cursorY,
            visible: !altScreen ? true : true
          },
          getLine: (y) => term.buffer.active.getLine(y) as IBufferLine | undefined
        };
      }
    });

    const setSpacerHeight = (): void => {
      const bufferLength = term.buffer.active.length;
      const hiddenRows = Math.max(0, bufferLength - term.rows);
      spacer.style.height = altScreen ? "0px" : `${hiddenRows * cellH}px`;
    };

    const isAtBottom = (): boolean => {
      if (altScreen) return true;
      return (
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
        cellH * STICK_TOLERANCE_ROWS
      );
    };

    const scrollToBottom = (): void => {
      suppressUserDetection = true;
      scroller.scrollTop = scroller.scrollHeight;
      requestAnimationFrame(() => {
        suppressUserDetection = false;
      });
    };

    const scheduleRender = (): void => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (disposed) return;
        setSpacerHeight();
        renderer.update();
      });
    };

    const onScrollEvent = (): void => {
      if (suppressUserDetection) return;
      wasAtBottom = isAtBottom();
      scheduleRender();
    };

    const handleBufferChange = (): void => {
      const prev = altScreen;
      altScreen = term.buffer.active.type === "alternate";
      setIsAltScreen(altScreen);
      if (prev !== altScreen) {
        debugLog("terminal", "alt-screen", {
          from: prev ? "alt" : "normal",
          to: altScreen ? "alt" : "normal"
        });
      }
      if (altScreen) {
        suppressUserDetection = true;
        scroller.scrollTop = 0;
        requestAnimationFrame(() => (suppressUserDetection = false));
      }
      scheduleRender();
    };

    const onWriteParsedDisposable = term.onWriteParsed(scheduleRender);
    const onScrollDisposable = term.onScroll(scheduleRender);
    const onCursorMoveDisposable = term.onCursorMove(scheduleRender);
    const onBufferDisposable = term.buffer.onBufferChange(handleBufferChange);

    // During a session switch we hold terminal-WS bytes until the seed has
    // been written. Two WS connections (control = seed, terminal = live
    // PTY) have no cross-ordering guarantee; without the gate the new
    // tmux attach's initial redraw can race ahead, queue in xterm's
    // _writeBuffer, and parse into the post-reset buffer (reset does
    // not drain _writeBuffer) — leaving cursor + modes out of sync with
    // what tmux thinks.
    //
    // The gate MUST open the same tick `select_session` is sent, not the
    // tick the seed arrives. The dispatcher calls `beginSessionSwitch()`
    // on the store so this subscription can flip the local flag
    // synchronously with the request leaving.
    //
    // We DISCARD queued bytes instead of replaying them. The seed is the
    // authoritative snapshot of the target pane's visible area +
    // scrollback (capturePane with historyOnly=false, see e768e30). The
    // queued bytes are tmux's first-attach redraw — redundant content,
    // plus mode-altering sequences (e.g. `ESC[?1049h` when the target
    // pane is in alt-screen). Replaying those AFTER the seed writes
    // into the normal buffer flips the buffer to alt, collapses the
    // spacer, and hides scrollback. Dropping them loses at most a frame
    // of deltas; tmux's next repaint (claude code/vim both repaint on
    // activity) restores the true mode state.
    let switching = false;
    const pendingBytes: string[] = [];
    let switchTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const SWITCH_GATE_TIMEOUT_MS = 5000;

    const dropPending = (): number => {
      const dropped = pendingBytes.length;
      pendingBytes.length = 0;
      return dropped;
    };

    const releaseSwitchGate = (reason: "seed" | "same-pane" | "timeout"): void => {
      if (!switching) return;
      const dropped = dropPending();
      switching = false;
      if (switchTimeoutId) {
        clearTimeout(switchTimeoutId);
        switchTimeoutId = null;
      }
      useTerminalStore.getState().endSessionSwitch(slotId);
      debugLog("terminal", "session-switch-gate-close", {
        slotId,
        reason,
        queuedBytesDropped: dropped
      });
    };

    const armSwitchTimeout = (): void => {
      if (switchTimeoutId) clearTimeout(switchTimeoutId);
      switchTimeoutId = setTimeout(() => {
        switchTimeoutId = null;
        if (!switching) return;
        debugLog("terminal", "session-switch-gate-timeout", {
          pendingBytes: pendingBytes.length
        });
        releaseSwitchGate("timeout");
      }, SWITCH_GATE_TIMEOUT_MS);
    };

    let lastSwitchPending = useTerminalStore.getState().slots[slotId].sessionSwitchPending;
    const unsubSwitchGate = useTerminalStore.subscribe((state) => {
      const now = state.slots[slotId].sessionSwitchPending;
      if (now && !lastSwitchPending) {
        switching = true;
        armSwitchTimeout();
        debugLog("terminal", "session-switch-gate-open", { slotId });
      }
      lastSwitchPending = now;
    });

    const writeChunk = (chunk: string): void => {
      const sticky = wasAtBottom;
      term.write(chunk, () => {
        setSpacerHeight();
        if (sticky && !altScreen) scrollToBottom();
      });
    };

    const ws = new TerminalWsClient({
      token,
      password: password || undefined,
      clientId,
      slot: slotId,
      onData: (chunk) => {
        if (switching) {
          pendingBytes.push(chunk);
          return;
        }
        writeChunk(chunk);
      }
    });

    const inputDisposable = term.onData((data) => ws.write(data));

    const applyResize = (): void => {
      const cols = Math.max(10, Math.floor(scroller.clientWidth / cellW));
      const rows = Math.max(5, Math.floor(scroller.clientHeight / cellH));
      const resized = cols !== term.cols || rows !== term.rows;
      if (resized) {
        debugLog("terminal", "resize", {
          fromCols: term.cols,
          fromRows: term.rows,
          toCols: cols,
          toRows: rows,
          clientW: scroller.clientWidth,
          clientH: scroller.clientHeight,
          cellW,
          cellH
        });
        term.resize(cols, rows);
        ws.resize(cols, rows);
        // Mirror through the control socket: the grid takes a beat to settle
        // on first paint, and the terminal socket is opened only after the
        // seed round-trip — so the measurement that arrived mid-handshake
        // would otherwise be lost.
        onReadyRef.current?.(cols, rows);
        // term.resize reflows the buffer — every row's content likely
        // mutated even though the row COUNT may be unchanged. DomRenderer
        // diffs by row HTML cache; without invalidation it can decide
        // "nothing changed" and leave the DOM showing pre-reflow content
        // until the next term.write() fires onWriteParsed. Force a full
        // repaint on the next rAF.
        renderer.invalidate();
        if (wasAtBottom && !altScreen) {
          requestAnimationFrame(() => {
            if (disposed) return;
            scrollToBottom();
          });
        }
      }
      setSpacerHeight();
      scheduleRender();
    };

    const refitCols = applyResize;

    const resizeObserver = new ResizeObserver(refitCols);
    resizeObserver.observe(scroller);
    window.addEventListener("resize", refitCols);

    // Once the custom terminal font has loaded, re-measure cell width. If
    // the advance changed, refit — otherwise the terminal stays at the
    // fallback-font's col count for the lifetime of the session, which
    // manifests as misaligned rows/cursor for the first couple seconds
    // after attach (and after session switch once seed lands).
    if (typeof document !== "undefined" && document.fonts) {
      void document.fonts.ready.then(() => {
        if (disposed) return;
        const fresh = measureCellMetrics();
        const delta = fresh.cellWidthPx - cellW;
        debugLog("terminal", "fonts-ready", {
          oldCellW: cellW,
          newCellW: fresh.cellWidthPx,
          delta
        });
        if (Math.abs(delta) >= 0.1) {
          cellW = fresh.cellWidthPx;
          applyResize();
        }
      });
    }
    scroller.addEventListener("scroll", onScrollEvent, { passive: true });

    // Tracks the paneId of the last seed we consumed. When a new seed arrives
    // with a DIFFERENT paneId, the user switched to another base session and
    // the previous pane's terminal state (most critically: alt-screen, but
    // also bracketed paste, mouse tracking, scroll regions) would otherwise
    // leak into the new attach. The old tmux client is killed without a
    // clean detach, so it never emits the exit-alt sequence; the new client
    // doesn't emit it either (it has no way to know we're in alt). Result
    // without this reset: xterm is stuck in alt-screen forever, spacer=0,
    // user cannot scroll up.
    let lastSeedPaneId: string | null = null;

    const start = (): void => {
      requestAnimationFrame(() => {
        if (disposed) return;
        // Initial sizing must be synchronous — the backend gates tmux
        // attach on onReady's cols/rows. Debouncing would fire onReady
        // with stale constructor defaults.
        applyResize();
        setSpacerHeight();
        scrollToBottom();
        onReadyRef.current?.(term.cols, term.rows);

        const writeSeedAndConnect = (): void => {
          const seed = useTerminalStore.getState().slots[slotId].seed;
          if (seed && seed.text.length > 0) {
            lastSeedPaneId = seed.paneId;
            // tmux capture-pane emits bare LF; xterm's default LF advances the
            // row without returning the cursor column, so a raw seed
            // stair-steps. Normalize to CRLF before writing.
            const seedText = seed.text.replace(/(?<!\r)\n/g, "\r\n");
            term.write(seedText, () => {
              if (disposed) return;
              clearSeed(slotId);
              setSpacerHeight();
              scrollToBottom();
              scheduleRender();
              ws.connect();
            });
          } else {
            ws.connect();
          }
        };

        if (useTerminalStore.getState().slots[slotId].seed) {
          writeSeedAndConnect();
        } else {
          const t = setTimeout(() => {
            if (disposed) return;
            writeSeedAndConnect();
          }, SEED_WAIT_MS);
          const unsubscribe = useTerminalStore.subscribe((state) => {
            if (state.slots[slotId].seed) {
              clearTimeout(t);
              unsubscribe();
              writeSeedAndConnect();
            }
          });
        }
      });
    };

    start();

    // Session-switch watcher: every subsequent seed (after the first one
    // consumed by start()) signals a session switch. Reset xterm so modes
    // from the prior attach don't leak, then write the new seed so the
    // user can scroll up into the new session's history immediately.
    // `switching` gates the WS onData path so any live bytes racing
    // across the other WS during the switch land AFTER the seed, not
    // interleaved with it.
    const unsubSessionSwitch = useTerminalStore.subscribe((state) => {
      const slotState = state.slots[slotId];
      if (!slotState.seed) return;
      if (lastSeedPaneId === null) return;
      if (slotState.seed.paneId === lastSeedPaneId) {
        // User re-selected the current session. Backend still re-attaches
        // and re-sends the seed, so the gate was opened on dispatch — but
        // there's no buffer to reset and no new content to write. Just
        // drain queued bytes and let the redraw land normally.
        clearSeed(slotId);
        releaseSwitchGate("same-pane");
        return;
      }
      const seed = slotState.seed;
      debugLog("terminal", "session-switch", {
        slotId,
        fromPaneId: lastSeedPaneId,
        toPaneId: seed.paneId,
        seedBytes: seed.text.length,
        gateAlreadyOpen: switching
      });
      lastSeedPaneId = seed.paneId;
      // Normally the gate is already open (beginSessionSwitch ran when
      // select_session left the page). But backend-initiated switches
      // (session_picker auto-pick, reconnect) don't go through the UI
      // dispatcher, so we set it here as a backstop.
      if (!switching) {
        switching = true;
        armSwitchTimeout();
      }
      term.reset();
      // term.reset empties the buffer but leaves DomRenderer's per-row
      // HTML diff cache pointing at pre-switch content. If the subsequent
      // seed + live-bytes happen to produce the SAME HTML for any row
      // (common for blank rows and simple prompts), the cache skips the
      // repaint and the DOM shows a mix of the old and new sessions.
      renderer.invalidate();
      altScreen = false;
      setIsAltScreen(false);
      wasAtBottom = true;
      const seedText = seed.text.replace(/(?<!\r)\n/g, "\r\n");
      term.write(seedText, () => {
        if (disposed) return;
        clearSeed(slotId);
        releaseSwitchGate("seed");
        setSpacerHeight();
        scheduleRender();
        scrollToBottom();
        debugLog("terminal", "session-switch-applied", {
          slotId,
          bufferLength: term.buffer.active.length,
          altAfter: altScreen
        });
      });
    });

    return () => {
      disposed = true;
      unsubSessionSwitch();
      unsubSwitchGate();
      if (switchTimeoutId) {
        clearTimeout(switchTimeoutId);
        switchTimeoutId = null;
      }
      scroller.removeEventListener("scroll", onScrollEvent);
      window.removeEventListener("resize", refitCols);
      resizeObserver.disconnect();
      inputDisposable.dispose();
      onWriteParsedDisposable.dispose();
      onScrollDisposable.dispose();
      onCursorMoveDisposable.dispose();
      onBufferDisposable.dispose();
      ws.close();
      renderer.destroy();
      term.dispose();
      terminalRef.current = null;
      setTerminal(null);
    };
  }, [clientId, token, password, scrollerRef, spacerRef, rowsRef, cursorRef, clearSeed, slotId]);

  return { terminal, isAltScreen };
}

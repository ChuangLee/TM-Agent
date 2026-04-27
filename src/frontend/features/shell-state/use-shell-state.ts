import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";
import { classify } from "./classifier.js";
import { useShellStateStore } from "../../stores/shell-state-store.js";
import { selectAttachedBaseState, useSessionsStore } from "../../stores/sessions-store.js";
import { useLayoutStore, type SlotId } from "../../stores/layout-store.js";

const DEBOUNCE_MS = 200;
const TAIL_ROWS = 5;

/**
 * Side-effect hook. Subscribes to the xterm buffer + tmux snapshot, classifies
 * the shell state on write/alt-screen/snapshot changes, and pushes the result
 * into `useShellStateStore`. Consumers (ActionPanel, PromptBanner, KeyOverlay,
 * ComposeBar's slash completion) read the store directly.
 *
 * Multi-slot (ADR-0013): every Surface mounts this hook, but only the focused
 * slot publishes. Without that gate every slot's classifier races against the
 * same global store while reading the legacy `attachedBaseSession` field, so
 * the published `cmd` belongs to neither the focused slot nor any consistent
 * pane — slash completion then resolves the wrong bucket (or null) and the
 * popover never opens.
 */
export function useShellState(terminal: Terminal | null, slotId: SlotId = 0 as SlotId): void {
  const setShellState = useShellStateStore((s) => s.set);
  const isPublishing = useLayoutStore((s) =>
    s.mode === 1 ? slotId === 0 : s.focusedSlot === slotId
  );
  const slotSession = useLayoutStore(
    (s) => s.slots.find((slot) => slot.id === slotId)?.attachedSession ?? ""
  );

  useEffect(() => {
    if (!terminal) return;
    if (!isPublishing) return;

    let lastOutputTs = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runClassify = (): void => {
      const tail = extractTail(terminal, TAIL_ROWS);
      const altScreen = terminal.buffer.active.type === "alternate";
      const { snapshot, attachedBaseSession } = useSessionsStore.getState();
      const baseName = slotSession || attachedBaseSession;
      const base = selectAttachedBaseState(snapshot, baseName);
      const activeWindow = base?.windowStates.find((w) => w.active);
      const activePane = activeWindow?.panes.find((p) => p.active);
      const cmd = activePane?.currentCommand ?? "";
      const result = classify({
        cmd,
        altScreen,
        tail,
        lastOutputTs,
        now: Date.now()
      });
      setShellState(result);
    };

    const schedule = (): void => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        runClassify();
      }, DEBOUNCE_MS);
    };

    const onWriteDisposable = terminal.onWriteParsed(() => {
      lastOutputTs = Date.now();
      schedule();
    });
    const onBufferChangeDisposable = terminal.buffer.onBufferChange(schedule);
    const snapshotUnsub = useSessionsStore.subscribe(schedule);

    runClassify();

    return () => {
      if (timer) clearTimeout(timer);
      onWriteDisposable.dispose();
      onBufferChangeDisposable.dispose();
      snapshotUnsub();
    };
  }, [terminal, setShellState, isPublishing, slotSession]);
}

function extractTail(term: Terminal, rows: number): string {
  const buf = term.buffer.active;
  const end = buf.length;
  const start = Math.max(0, end - rows);
  const out: string[] = [];
  for (let y = start; y < end; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    out.push(line.translateToString(true));
  }
  return out.join("\n");
}

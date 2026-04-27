import type { ReactElement } from "react";
import type { ControlClientMessage } from "../../../shared/protocol.js";
import { useLayoutStore } from "../../stores/layout-store.js";
import { SlotFrame } from "./SlotFrame.js";

export interface MultiSurfaceProps {
  send: (message: ControlClientMessage) => void;
}

/**
 * Renders 1 / 2 / 4 SlotFrames driven by useLayoutStore.mode.
 * - mode 1: single SlotFrame, no grid (slot 0 keeps the full viewport).
 * - mode 2: 1×2 horizontal grid (slots 0/1).
 * - mode 4: 2×2 grid (slots 0/1 top, 2/3 bottom).
 *
 * Slot 0 is keyed stably across mode changes so its terminal-WS + xterm
 * survive the layout switch (no re-attach unless attachedSession changed).
 */
export function MultiSurface({ send }: MultiSurfaceProps): ReactElement {
  const mode = useLayoutStore((s) => s.mode);
  const slots = useLayoutStore((s) => s.slots);

  if (mode === 1) {
    // Slot 0 intentionally REMOUNTS across mode changes. Preserving xterm
    // across a full-width ↔ half-width switch forces term.resize to reflow
    // the existing buffer with xterm's wrap rules, which diverges from
    // tmux's server-side reflow → the post-resize redraw lands on mismatched
    // rows and the last few lines misalign. A fresh xterm at the new dims
    // avoids that entirely. The 2→1 black-screen case is handled backend-
    // side: see server.ts `terminal_ready` re-seed when attachStarted.
    return (
      <div className="h-full" data-testid="multi-surface-single">
        <SlotFrame slotId={0} send={send} />
      </div>
    );
  }

  if (mode === 2) {
    return (
      <div className="grid h-full grid-cols-2 gap-px" data-testid="multi-surface-2cols">
        {slots.map((s) => (
          <SlotFrame key={s.id} slotId={s.id} send={send} />
        ))}
      </div>
    );
  }

  // mode === 4
  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-px" data-testid="multi-surface-quad">
      {slots.map((s) => (
        <SlotFrame key={s.id} slotId={s.id} send={send} />
      ))}
    </div>
  );
}

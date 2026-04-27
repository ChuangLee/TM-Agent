import type { TmuxStateSnapshot } from "../../shared/protocol.js";

export class PaneCwdError extends Error {
  public constructor(
    public readonly kind: "no_snapshot" | "pane_not_found" | "cwd_unknown",
    message: string
  ) {
    super(message);
    this.name = "PaneCwdError";
  }
}

/**
 * Look up `#{pane_current_path}` for a pane id in the latest tmux snapshot.
 * Throws {@link PaneCwdError} on every failure so route handlers can map to
 * a uniform HTTP 4xx. Reading from the snapshot (~2.5s stale) is fine — a
 * fresh `cd` shows up within one poll, well under user perception.
 */
export function resolvePaneCwd(snapshot: TmuxStateSnapshot | undefined, paneId: string): string {
  if (!snapshot) {
    throw new PaneCwdError("no_snapshot", "no tmux snapshot yet");
  }
  for (const session of snapshot.sessions) {
    for (const window of session.windowStates) {
      for (const pane of window.panes) {
        if (pane.id === paneId) {
          if (!pane.currentPath) {
            throw new PaneCwdError("cwd_unknown", `pane ${paneId} has no current_path`);
          }
          return pane.currentPath;
        }
      }
    }
  }
  throw new PaneCwdError("pane_not_found", `pane not found: ${paneId}`);
}

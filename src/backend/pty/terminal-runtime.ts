import { EventEmitter } from "node:events";
import type { PtyFactory, PtyProcess } from "./pty-adapter.js";

interface TerminalRuntimeEvents {
  data: (payload: string) => void;
  exit: (code: number) => void;
  attach: (session: string) => void;
}

export class TerminalRuntime {
  private readonly events = new EventEmitter();
  private process?: PtyProcess;
  private session?: string;
  private lastDimensions: { cols: number; rows: number } = { cols: 80, rows: 24 };

  public constructor(private readonly factory: PtyFactory) {}

  public currentSession(): string | undefined {
    return this.session;
  }

  public attachToSession(session: string, dimensions?: { cols: number; rows: number }): void {
    if (dimensions) {
      this.resize(dimensions.cols, dimensions.rows);
    }
    // Always respawn — even when the session is unchanged. A remounted
    // frontend (e.g., layout mode change) is attached to a new terminal-WS
    // but the old tmux-attach PTY has already sent its full-screen redraw
    // to the WS that just closed. Re-using the PTY leaves the new xterm's
    // cursor wherever the capture-pane seed happened to end, which rarely
    // matches tmux's actual cursor — subsequent CSI-positioned output lands
    // on mismatched rows. Respawning forces tmux to re-issue its attach
    // redraw to the new PTY's stdout, re-asserting cursor + pane contents.
    // Callers that genuinely want a no-op (redundant same-session click)
    // already dedup upstream: SlotFrame's attachedSession effect skips when
    // lastDispatchedRef matches.

    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }

    this.session = session;
    const processRef = this.factory.spawnTmuxAttach(session, this.lastDimensions);
    processRef.onData((data) => this.events.emit("data", data));
    processRef.onExit((code) => {
      this.events.emit("exit", code);
      if (this.process === processRef) {
        this.process = undefined;
      }
    });
    this.process = processRef;
    this.events.emit("attach", session);
  }

  public write(data: string): void {
    this.process?.write(data);
  }

  public resize(cols: number, rows: number): void {
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) {
      return;
    }
    this.lastDimensions = { cols: Math.floor(cols), rows: Math.floor(rows) };
    this.process?.resize(this.lastDimensions.cols, this.lastDimensions.rows);
  }

  public on<K extends keyof TerminalRuntimeEvents>(
    event: K,
    handler: TerminalRuntimeEvents[K]
  ): () => void {
    this.events.on(event, handler as (...args: unknown[]) => void);
    return () => this.events.off(event, handler as (...args: unknown[]) => void);
  }

  public shutdown(): void {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
  }
}

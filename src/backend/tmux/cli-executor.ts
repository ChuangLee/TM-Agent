import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { parsePanes, parseSessions, parseWindows } from "./parser.js";
import type { TmuxGateway } from "./types.js";
import { withoutTmuxEnv } from "../util/env.js";

const expandHome = (path: string): string => {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return `${homedir()}/${trimmed.slice(2)}`;
  return trimmed;
};

const execFileAsync = promisify(execFile);

const SESSION_FMT = "#{session_name}\t#{session_attached}\t#{session_windows}\t#{session_activity}";
const WINDOW_FMT = "#{window_index}\t#{window_name}\t#{window_active}\t#{window_panes}";
const ACTIVE_PANE_ZOOM_FMT = "#{?#{&&:#{window_zoomed_flag},#{pane_active}},1,0}";
const PANE_FMT = `#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_active}\t#{pane_width}x#{pane_height}\t${ACTIVE_PANE_ZOOM_FMT}\t#{pane_current_path}`;

interface TmuxCliExecutorOptions {
  socketName?: string;
  socketPath?: string;
  tmuxBinary?: string;
  timeoutMs?: number;
  logger?: Pick<Console, "log" | "error">;
}

const isNoServerRunningError = (message: string): boolean =>
  /no server running|failed to connect to server|error connecting to .*no such file or directory/i.test(
    message
  );

export class TmuxCliExecutor implements TmuxGateway {
  private readonly tmuxBinary: string;
  private readonly tmuxArgsPrefix: string[];
  private readonly timeoutMs: number;
  private readonly logger?: Pick<Console, "log" | "error">;
  private readonly traceTmux: boolean;

  public constructor(options: TmuxCliExecutorOptions = {}) {
    if (options.socketName && options.socketPath) {
      throw new Error("tmux socketName and socketPath are mutually exclusive");
    }

    this.tmuxBinary = options.tmuxBinary ?? "tmux";
    this.tmuxArgsPrefix = options.socketPath
      ? ["-S", options.socketPath]
      : options.socketName
        ? ["-L", options.socketName]
        : [];
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.logger = options.logger;
    this.traceTmux = process.env.TM_AGENT_TRACE_TMUX === "1";
  }

  private async runTmux(args: string[]): Promise<string> {
    const finalArgs = [...this.tmuxArgsPrefix, ...args];
    try {
      if (this.traceTmux) {
        this.logger?.log("[tmux]", this.tmuxBinary, finalArgs.join(" "));
      }
      const { stdout } = await execFileAsync(this.tmuxBinary, finalArgs, {
        timeout: this.timeoutMs,
        env: withoutTmuxEnv(process.env)
      });
      return stdout.trim();
    } catch (error) {
      const serialized = error instanceof Error ? error.message : String(error);
      throw new Error(
        `tmux command failed: ${this.tmuxBinary} ${finalArgs.join(" ")} => ${serialized}`
      );
    }
  }

  private async runTmuxMaybeNoServer(args: string[]): Promise<string | null> {
    try {
      return await this.runTmux(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNoServerRunningError(message)) {
        return null;
      }
      throw error;
    }
  }

  public async listSessions() {
    const output = await this.runTmuxMaybeNoServer(["list-sessions", "-F", SESSION_FMT]);
    if (!output) {
      return [];
    }
    return parseSessions(output);
  }

  public async listWindows(session: string) {
    const output = await this.runTmux(["list-windows", "-t", session, "-F", WINDOW_FMT]);
    if (!output) {
      return [];
    }
    return parseWindows(output);
  }

  public async listPanes(session: string, windowIndex: number) {
    const output = await this.runTmux([
      "list-panes",
      "-t",
      `${session}:${windowIndex}`,
      "-F",
      PANE_FMT
    ]);
    if (!output) {
      return [];
    }
    return parsePanes(output);
  }

  public async createSession(
    name: string,
    options: { cwd?: string; startupCommand?: string } = {}
  ): Promise<void> {
    const args = ["new-session", "-d", "-s", name];
    const cwd = options.cwd?.trim();
    if (cwd) {
      args.push("-c", expandHome(cwd));
    }
    await this.runTmux(args);
    const startupCommand = options.startupCommand?.trim();
    if (startupCommand) {
      // Direct send-keys (not the bracketed-paste compose path): the target is
      // a freshly-spawned shell, so we want normal "type + submit" semantics.
      await this.runTmux(["send-keys", "-t", name, startupCommand, "Enter"]);
    }
  }

  public async renameSession(oldName: string, newName: string): Promise<void> {
    await this.runTmux(["rename-session", "-t", oldName, newName]);
  }

  public async renameWindow(session: string, windowIndex: number, newName: string): Promise<void> {
    await this.runTmux(["rename-window", "-t", `${session}:${windowIndex}`, newName]);
  }

  public async createGroupedSession(name: string, targetSession: string): Promise<void> {
    await this.runTmux(["new-session", "-d", "-s", name, "-t", targetSession]);
  }

  public async killSession(name: string): Promise<void> {
    await this.runTmux(["kill-session", "-t", name]);
  }

  public async switchClient(session: string): Promise<void> {
    await this.runTmux(["switch-client", "-t", session]);
  }

  public async newWindow(session: string): Promise<void> {
    await this.runTmux(["new-window", "-t", session]);
  }

  public async killWindow(session: string, windowIndex: number): Promise<void> {
    await this.runTmux(["kill-window", "-t", `${session}:${windowIndex}`]);
  }

  public async selectWindow(session: string, windowIndex: number): Promise<void> {
    await this.runTmux(["select-window", "-t", `${session}:${windowIndex}`]);
  }

  public async splitWindow(paneId: string, orientation: "h" | "v"): Promise<void> {
    await this.runTmux(["split-window", `-${orientation}`, "-t", paneId]);
  }

  public async killPane(paneId: string): Promise<void> {
    await this.runTmux(["kill-pane", "-t", paneId]);
  }

  public async selectPane(paneId: string): Promise<void> {
    await this.runTmux(["select-pane", "-t", paneId]);
  }

  public async zoomPane(paneId: string): Promise<void> {
    await this.runTmux(["resize-pane", "-Z", "-t", paneId]);
  }

  public async isPaneZoomed(paneId: string): Promise<boolean> {
    const output = await this.runTmux([
      "display-message",
      "-p",
      "-t",
      paneId,
      ACTIVE_PANE_ZOOM_FMT
    ]);
    return output === "1";
  }

  public async sendKeys(target: string, text: string): Promise<void> {
    // Claude Code's TUI (crossterm-based) treats a multi-byte burst that
    // ends in CR as "paste with trailing newline" rather than "text + submit"
    // unless the burst is explicitly wrapped in bracketed paste markers.
    // tmux 3.5 added a `-p` flag to send-keys that emits the brackets
    // automatically, but we're on 3.4, so do it by hand: stage the text in a
    // tmux buffer and paste it with bracketed-paste markers, then send Enter
    // as a standalone key.
    if (text.length > 0) {
      const bufferName = `tm-agent-compose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await this.runTmux(["set-buffer", "-b", bufferName, text]);
      // `-p` emits `\e[200~…\e[201~` bracketed-paste markers when the target
      // has paste mode on; `-d` deletes the buffer after paste; `-r` disables
      // the default LF→CR replacement so multi-line text keeps literal LFs
      // inside the paste block (Claude treats those as in-message newlines).
      await this.runTmux(["paste-buffer", "-dpr", "-b", bufferName, "-t", target]);
      // Give the target app's input loop a moment to fully digest the
      // paste-end marker before the standalone Enter arrives. Without this,
      // Claude Code's crossterm reader intermittently coalesces the Enter
      // into the paste cleanup and drops it, leaving text stuck in the input
      // (probe observed ~1/8 failures at 0ms delay, ~0/8 at 120ms).
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    await this.runTmux(["send-keys", "-t", target, "Enter"]);
  }

  public async capturePane(
    paneId: string,
    lines: number,
    includeEscapes = false,
    historyOnly = false
  ): Promise<string> {
    const args = ["capture-pane", "-t", paneId, "-p", "-S", `-${lines}`];
    if (historyOnly) args.push("-E", "-1");
    if (includeEscapes) args.push("-e");
    return this.runTmux(args);
  }
}

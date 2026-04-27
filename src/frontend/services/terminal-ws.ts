import { wsUrl } from "../lib/base-url.js";

export type TerminalDataHandler = (chunk: string) => void;
export type TerminalStatusHandler = (status: TerminalWsStatus) => void;

export type TerminalWsStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "closed"; code: number; reason: string };

export interface TerminalWsOptions {
  token: string;
  password: string | undefined;
  clientId: string;
  /** ADR-0013 slot id this socket speaks for. Defaults to 0 if omitted. */
  slot?: number;
  url?: string;
  onData: TerminalDataHandler;
  onStatus?: TerminalStatusHandler;
}

export class TerminalWsClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly token: string;
  private readonly password: string | undefined;
  private readonly clientId: string;
  private readonly slot: number;
  private readonly onData: TerminalDataHandler;
  private readonly onStatus: TerminalStatusHandler | undefined;

  public constructor(opts: TerminalWsOptions) {
    this.url = opts.url ?? deriveWsUrl("ws/terminal");
    this.token = opts.token;
    this.password = opts.password;
    this.clientId = opts.clientId;
    this.slot = opts.slot ?? 0;
    this.onData = opts.onData;
    this.onStatus = opts.onStatus;
  }

  public connect(): void {
    if (this.socket) return;
    this.onStatus?.({ kind: "connecting" });
    const socket = new WebSocket(this.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.onStatus?.({ kind: "open" });
      socket.send(
        JSON.stringify({
          type: "auth",
          token: this.token,
          password: this.password,
          clientId: this.clientId,
          slot: this.slot
        })
      );
    });

    socket.addEventListener("message", (event) => {
      const { data } = event;
      if (typeof data === "string") {
        this.onData(data);
        return;
      }
      if (data instanceof ArrayBuffer) {
        this.onData(new TextDecoder().decode(data));
      }
    });

    socket.addEventListener("close", (event) => {
      this.socket = null;
      this.onStatus?.({
        kind: "closed",
        code: event.code,
        reason: event.reason
      });
    });
  }

  public write(chunk: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(chunk);
    }
  }

  public resize(cols: number, rows: number): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }

  public close(code = 1000, reason = "client close"): void {
    this.socket?.close(code, reason);
    this.socket = null;
  }
}

const deriveWsUrl = (path: string): string => wsUrl(path);

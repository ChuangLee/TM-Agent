import type {
  ClientCapabilities,
  ControlClientMessage,
  ControlServerMessage
} from "../../shared/protocol.js";
import { wsUrl } from "../lib/base-url.js";

export type ControlMessageHandler = (message: ControlServerMessage) => void;
export type ControlStatusHandler = (status: ControlWsStatus) => void;

export type ControlWsStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "closed"; code: number; reason: string };

export interface ControlWsOptions {
  token: string;
  password: string | undefined;
  url?: string;
  onMessage: ControlMessageHandler;
  onStatus?: ControlStatusHandler;
  /**
   * ADR-0015 §2: negotiated at auth time. The server only sends
   * `tmux_state_delta` messages to clients that declare `stateDelta: true`.
   */
  capabilities?: ClientCapabilities;
}

export class ControlWsClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly token: string;
  private readonly password: string | undefined;
  private readonly onMessage: ControlMessageHandler;
  private readonly onStatus: ControlStatusHandler | undefined;
  private readonly capabilities: ClientCapabilities | undefined;
  private closedByUser = false;

  public constructor(opts: ControlWsOptions) {
    this.url = opts.url ?? deriveWsUrl("ws/control");
    this.token = opts.token;
    this.password = opts.password;
    this.onMessage = opts.onMessage;
    this.onStatus = opts.onStatus;
    this.capabilities = opts.capabilities;
  }

  public connect(): void {
    if (this.socket) return;
    this.closedByUser = false;
    this.onStatus?.({ kind: "connecting" });
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.onStatus?.({ kind: "open" });
      this.send({
        type: "auth",
        token: this.token,
        password: this.password,
        ...(this.capabilities ? { capabilities: this.capabilities } : {})
      });
    });

    socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as ControlServerMessage;
        this.onMessage(parsed);
      } catch {
        // ignore malformed payloads; the server only sends JSON on this socket
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

  public send(message: ControlClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  public close(code = 1000, reason = "client close"): void {
    this.closedByUser = true;
    this.socket?.close(code, reason);
    this.socket = null;
  }

  public get wasClosedByUser(): boolean {
    return this.closedByUser;
  }
}

const deriveWsUrl = (path: string): string => wsUrl(path);

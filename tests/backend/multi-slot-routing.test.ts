import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { startE2EServer, type StartedE2EServer } from "../e2e/harness/test-server.js";
import { openSocket, waitForMessage, waitForOpen } from "../harness/ws.js";

let server: StartedE2EServer;

beforeEach(async () => {
  server = await startE2EServer({
    sessions: ["main", "work"],
    attachedSession: "main"
  });
});

afterEach(async () => {
  await server?.stop();
});

interface AuthOk {
  type: "auth_ok";
  clientId: string;
}

const authControlAndAttachSlot0 = async (): Promise<{
  control: WebSocket;
  clientId: string;
}> => {
  const control = await openSocket(`${server.baseUrl.replace(/^http/, "ws")}/ws/control`);
  control.send(JSON.stringify({ type: "auth", token: server.token }));
  const auth = await waitForMessage<AuthOk>(control, (m: AuthOk) => m.type === "auth_ok");

  // Multi-session setup: server sends session_picker; the real frontend
  // picks one and dispatches select_session. Mirror that here.
  let pickerHandled = false;
  control.on("message", (raw) => {
    if (pickerHandled) return;
    const msg = JSON.parse(raw.toString("utf8")) as {
      type: string;
      sessions?: Array<{ name: string }>;
    };
    if (msg.type === "session_picker") {
      pickerHandled = true;
      const pick = msg.sessions?.[0]?.name;
      if (pick) {
        control.send(JSON.stringify({ type: "select_session", session: pick, slot: 0 }));
      }
    }
  });

  // Frontend always sends terminal_ready before slot 0 attaches.
  control.send(
    JSON.stringify({
      type: "terminal_ready",
      cols: 100,
      rows: 30,
      slot: 0
    })
  );
  // Wait for the attached message to confirm slot 0 is wired up.
  await waitForMessage<{ type: string; slot?: number }>(
    control,
    (m) => m.type === "attached" && (m.slot ?? 0) === 0,
    5000
  );
  return { control, clientId: auth.clientId };
};

const openTerminalSocketForSlot = async (clientId: string, slot: number): Promise<WebSocket> => {
  const socket = new WebSocket(`${server.baseUrl.replace(/^http/, "ws")}/ws/terminal`);
  await waitForOpen(socket);
  socket.send(
    JSON.stringify({
      type: "auth",
      token: server.token,
      clientId,
      slot
    })
  );
  return socket;
};

describe("multi-slot wire routing (ADR-0013)", () => {
  test("slot 0 PTY data routes only to slot 0's terminal-WS", async () => {
    const { control, clientId } = await authControlAndAttachSlot0();
    const slot0Ws = await openTerminalSocketForSlot(clientId, 0);

    // Tiny grace period so the auth handshake completes server-side.
    await new Promise((r) => setTimeout(r, 50));

    const slot0Process = server.ptyFactory.processes[0];
    expect(slot0Process).toBeDefined();

    const received: string[] = [];
    slot0Ws.on("message", (raw) => received.push(raw.toString("utf8")));

    slot0Process.emitData("hello slot 0");
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toContain("hello slot 0");
    slot0Ws.close();
    control.close();
  });

  test("select_session{slot:1} spawns a separate PTY isolated from slot 0", async () => {
    const { control, clientId } = await authControlAndAttachSlot0();
    expect(server.ptyFactory.processes).toHaveLength(1);

    // Frontend would dispatch terminal_ready for slot 1 first, then select.
    control.send(
      JSON.stringify({
        type: "terminal_ready",
        cols: 80,
        rows: 24,
        slot: 1
      })
    );
    control.send(
      JSON.stringify({
        type: "select_session",
        session: "work",
        slot: 1
      })
    );

    // Wait for the slot 1 attached message.
    await waitForMessage<{ type: string; slot?: number }>(
      control,
      (m) => m.type === "attached" && m.slot === 1
    );

    expect(server.ptyFactory.processes.length).toBeGreaterThanOrEqual(2);
    const slot1Process = server.ptyFactory.processes[server.ptyFactory.processes.length - 1];

    // Open a slot-1-bound terminal-WS and verify routing.
    const slot1Ws = await openTerminalSocketForSlot(clientId, 1);
    await new Promise((r) => setTimeout(r, 50));

    const received: string[] = [];
    slot1Ws.on("message", (raw) => received.push(raw.toString("utf8")));

    slot1Process.emitData("hello slot 1");
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toContain("hello slot 1");
    slot1Ws.close();
    control.close();
  });

  test("duplicate attach (same base in two slots) is rejected", async () => {
    const { control } = await authControlAndAttachSlot0();

    // Slot 0 is already on "main". Try attaching slot 1 to "main" too.
    control.send(
      JSON.stringify({
        type: "terminal_ready",
        cols: 80,
        rows: 24,
        slot: 1
      })
    );
    control.send(
      JSON.stringify({
        type: "select_session",
        session: "main",
        slot: 1
      })
    );

    const err = await waitForMessage<{ type: string; message?: string }>(
      control,
      (m) => m.type === "error",
      4000
    );
    expect(err.type).toBe("error");
    expect(err.message ?? "").toContain("already attached");

    control.close();
  });

  test("detach_slot tears down the slot's runtime + grouped session", async () => {
    const { control } = await authControlAndAttachSlot0();
    control.send(
      JSON.stringify({
        type: "terminal_ready",
        cols: 80,
        rows: 24,
        slot: 1
      })
    );
    control.send(
      JSON.stringify({
        type: "select_session",
        session: "work",
        slot: 1
      })
    );
    await waitForMessage<{ type: string; slot?: number }>(
      control,
      (m) => m.type === "attached" && m.slot === 1
    );

    const before = server.tmux.sessions.length;
    control.send(JSON.stringify({ type: "detach_slot", slot: 1 }));
    await new Promise((r) => setTimeout(r, 100));

    // The grouped client (tm-agent-client-...-1) should be gone.
    expect(server.tmux.sessions.length).toBeLessThan(before);

    control.close();
  });
});

import { expect, test } from "@playwright/test";
import { startE2EServer, type StartedE2EServer } from "./harness/test-server.js";

let server: StartedE2EServer;

test.beforeEach(async () => {
  server = await startE2EServer({
    sessions: ["main"],
    attachedSession: "main",
    password: "letmein"
  });
});

test.afterEach(async ({ page }) => {
  await page.close();
  await server?.stop();
});

test("auth → attach → send command → receive output", async ({ page }) => {
  await page.goto(`${server.baseUrl}/?token=${server.token}`);

  const passwordInput = page.getByPlaceholder("password");
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill("letmein");
  await page.getByRole("button", { name: /unlock/i }).click();

  await expect(page.getByTestId("tm-rows")).toBeVisible({ timeout: 10_000 });

  // Wait for the fake PTY to register with the factory.
  await expect
    .poll(() => server.ptyFactory.processes.length, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const pty = server.ptyFactory.latestProcess();
  pty.emitData("hello from fake pty\r\n");

  // Type a command via ComposeBar and send.
  const compose = page.getByPlaceholder("Type a command or prompt…");
  await compose.fill("ls -la");
  await compose.press("Enter");

  // send_compose routes through `tmux send-keys` (not the attached PTY) so that
  // text + Enter arrive as individual key events and bypass tmux's
  // bracketed-paste heuristic. The FakeTmuxGateway records the call.
  await expect
    .poll(() => server.tmux.calls.filter((c) => c.startsWith("sendKeys:")), {
      timeout: 5_000,
      message: `tmux.calls=${JSON.stringify(server.tmux.calls)}`
    })
    .toContainEqual(expect.stringContaining(":ls -la"));
});

test("desktop width shows permanent sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.goto(`${server.baseUrl}/?token=${server.token}`);
  await page.getByPlaceholder("password").fill("letmein");
  await page.getByRole("button", { name: /unlock/i }).click();
  await expect(page.getByTestId("tm-rows")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toBeHidden({
    timeout: 500
  });
});

test("mobile width hides sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.baseUrl}/?token=${server.token}`);
  await page.getByPlaceholder("password").fill("letmein");
  await page.getByRole("button", { name: /unlock/i }).click();
  await expect(page.getByTestId("tm-rows")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("aside")).toBeHidden();
});

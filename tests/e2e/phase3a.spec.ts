import { expect, test } from "@playwright/test";
import { startE2EServer, type StartedE2EServer } from "./harness/test-server.js";

let server: StartedE2EServer;

test.beforeEach(async () => {
  server = await startE2EServer({
    sessions: ["main", "work", "scratch"],
    attachedSession: "main",
    password: "letmein"
  });
});

test.afterEach(async ({ page }) => {
  await page.close();
  await server?.stop();
});

const login = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.goto(`${server.baseUrl}/?token=${server.token}`);
  await page.getByPlaceholder("password").fill("letmein");
  await page.getByRole("button", { name: /unlock/i }).click();
  await expect(page.getByTestId("tm-rows")).toBeVisible({ timeout: 10_000 });
};

test("desktop sidebar lists every tmux session on first load", async ({
  page,
  browserName: _browserName
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);

  const list = page.getByTestId("session-list");
  await expect(list).toBeVisible();

  // Three seeded sessions + the client's own `tm-agent-client-*` grouped
  // session. The grouped one is a transport detail and must be hidden.
  const items = list.getByTestId("session-list-item");
  await expect.poll(() => items.count(), { timeout: 10_000 }).toBe(3);
  await expect(items.nth(0)).toHaveAttribute("data-session", "main");
  await expect(items.nth(1)).toHaveAttribute("data-session", "work");
  await expect(items.nth(2)).toHaveAttribute("data-session", "scratch");
});

test("clicking a sidebar session dispatches select_session", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);

  const workItem = page.getByTestId("session-list").locator('[data-session="work"]');
  await workItem.click();

  // Backend responds to select_session by calling createGroupedSession:<client>:work.
  await expect
    .poll(
      () =>
        server.tmux.calls.filter(
          (c) => c.startsWith("createGroupedSession:") && c.endsWith(":work")
        ).length,
      { timeout: 5_000 }
    )
    .toBeGreaterThan(0);
});

test("mobile: tapping TopBar session name opens the drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  // Sidebar is hidden on mobile — the drawer is the only entry point.
  await expect(page.getByTestId("session-drawer")).toHaveCount(0);

  // The TopBar session-name button is the labeled Sessions control.
  await page
    .getByRole("button", { name: /sessions/i })
    .first()
    .click();
  await expect(page.getByTestId("session-drawer")).toBeVisible();

  const items = page.getByTestId("session-drawer").getByTestId("session-list-item");
  await expect.poll(() => items.count(), { timeout: 5_000 }).toBe(3);
});

test("connection status dot reflects open socket and flips to Reconnect on drop", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);

  const dot = page.getByTestId("connection-status");
  await expect(dot).toHaveAttribute("data-status", "open");
  await expect(page.getByRole("button", { name: /reconnect/i })).toHaveCount(0);

  // Stopping the test server fires close events on every active WS; the
  // frontend's ControlWsClient propagates that to connection-store.
  await server.stop();

  await expect(dot).toHaveAttribute("data-status", "closed", { timeout: 10_000 });
  await expect(page.getByRole("button", { name: /reconnect/i })).toBeVisible();
});

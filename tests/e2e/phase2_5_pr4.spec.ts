import { expect, test } from "@playwright/test";
import { startE2EServer, type StartedE2EServer } from "./harness/test-server.js";

let server: StartedE2EServer;

const KEY_OVERLAY_OPEN_RE = /打开按键层|Open key overlay/i;
const COMPOSE_LINK_RE = /打开输入栏|Open compose bar/i;

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

const login = async (page: import("@playwright/test").Page, searchSuffix = ""): Promise<void> => {
  await page.goto(`${server.baseUrl}/?token=${server.token}${searchSuffix}`);
  await page.getByPlaceholder("password").fill("letmein");
  await page.getByRole("button", { name: /unlock/i }).click();
  await expect(page.getByTestId("tm-rows")).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => server.ptyFactory.processes.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
};

test("mobile: TopBar ⌨ button opens the KeyOverlay", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const kbdToggle = page.getByRole("button", { name: KEY_OVERLAY_OPEN_RE });
  await expect(kbdToggle).toBeVisible();
  await kbdToggle.click();
  await expect(page.locator(".tm-key-overlay")).toBeVisible();
});

test("Ctrl armed + tap c sends \\x03 and auto-releases Ctrl", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const pty = server.ptyFactory.latestProcess();
  const baseline = pty.writes.length;

  await page.getByRole("button", { name: KEY_OVERLAY_OPEN_RE }).click();
  const overlay = page.locator(".tm-key-overlay");
  await expect(overlay).toBeVisible();

  // Arm Ctrl (tap, not long-press)
  const ctrlBtn = overlay.getByRole("button", { name: /^Ctrl$/ });
  await ctrlBtn.dispatchEvent("pointerdown");
  await ctrlBtn.dispatchEvent("pointerup");
  await expect(ctrlBtn).toHaveAttribute("data-mod-state", "armed");

  // Tap c letter key (must be visible because Ctrl is armed)
  await overlay.locator(".tm-overlay-key-letter", { hasText: /^c$/ }).click();

  await expect.poll(() => pty.writes.slice(baseline).join(""), { timeout: 5_000 }).toBe("\x03");
  await expect(ctrlBtn).toHaveAttribute("data-mod-state", "idle");
});

test("Enter key in overlay sends \\r", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const pty = server.ptyFactory.latestProcess();
  await page.getByRole("button", { name: KEY_OVERLAY_OPEN_RE }).click();
  const baseline = pty.writes.length;
  await page.locator(".tm-key-overlay").getByRole("button", { name: /Enter/ }).click();
  await expect.poll(() => pty.writes.slice(baseline).join(""), { timeout: 5_000 }).toBe("\r");
});

test("Fn toggle reveals F1..F12 row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: KEY_OVERLAY_OPEN_RE }).click();
  const overlay = page.locator(".tm-key-overlay");
  await expect(overlay.getByRole("button", { name: /^F1$/ })).toHaveCount(0);
  await overlay.getByRole("button", { name: /^Fn$/ }).click();
  await expect(overlay.getByRole("button", { name: /^F1$/ })).toBeVisible();
  await expect(overlay.getByRole("button", { name: /^F12$/ })).toBeVisible();
});

test("F5 sends CSI 15~ to the PTY", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const pty = server.ptyFactory.latestProcess();
  await page.getByRole("button", { name: KEY_OVERLAY_OPEN_RE }).click();
  await page.locator(".tm-key-overlay").getByRole("button", { name: /^Fn$/ }).click();
  const baseline = pty.writes.length;
  await page.locator(".tm-key-overlay").getByRole("button", { name: /^F5$/ }).click();
  await expect.poll(() => pty.writes.slice(baseline).join(""), { timeout: 5_000 }).toBe("\x1b[15~");
});

test("compose link closes overlay", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: KEY_OVERLAY_OPEN_RE }).click();
  await expect(page.locator(".tm-key-overlay")).toBeVisible();
  await page.locator(".tm-key-overlay").getByRole("button", { name: COMPOSE_LINK_RE }).click();
  await expect(page.locator(".tm-key-overlay")).toHaveCount(0);
});

test("desktop: ⌨ toggle is NOT rendered on wide viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await expect(page.getByRole("button", { name: KEY_OVERLAY_OPEN_RE })).toHaveCount(0);
});

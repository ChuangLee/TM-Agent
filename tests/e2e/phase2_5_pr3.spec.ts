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

const login = async (page: import("@playwright/test").Page, searchSuffix = ""): Promise<void> => {
  await page.goto(`${server.baseUrl}/?token=${server.token}${searchSuffix}`);
  await page.getByPlaceholder("password").fill("letmein");
  await page.getByRole("button", { name: /unlock/i }).click();
  await expect(page.getByTestId("tm-rows")).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => server.ptyFactory.processes.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
};

test("confirm_prompt: apt [Y/n] prompt surfaces Yes/No banner; Yes sends y\\r", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  // Allow the initial scrollback seed + snapshot + classifier debounce to
  // settle before we seed the prompt tail.
  await page.waitForTimeout(400);

  const pty = server.ptyFactory.latestProcess();
  // Feed a realistic apt-like confirm tail into the buffer.
  pty.emitData(
    "The following packages will be installed:\r\n  libfoo libbar\r\nDo you want to continue? [Y/n] "
  );

  const banner = page.locator(".tm-prompt-banner");
  await expect(banner).toBeVisible({ timeout: 10_000 });

  const baseline = pty.writes.length;
  await banner.getByRole("button", { name: /是|Yes/i }).click();
  await expect.poll(() => pty.writes.slice(baseline).join(""), { timeout: 5_000 }).toBe("y\r");
});

test("confirm_prompt: [y/N] marks No as default", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.waitForTimeout(400);

  const pty = server.ptyFactory.latestProcess();
  pty.emitData("Proceed with installation? [y/N] ");

  const banner = page.locator(".tm-prompt-banner");
  await expect(banner).toBeVisible({ timeout: 10_000 });
  const noBtn = banner.getByRole("button", { name: /否|No/i });
  await expect(noBtn).toHaveAttribute("data-default", "true");
  const yesBtn = banner.getByRole("button", { name: /是|Yes/i });
  await expect(yesBtn).toHaveAttribute("data-default", "false");
});

test("password_prompt: sudo prompt renders <input type=password>; Enter sends value + \\r", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.waitForTimeout(400);

  const pty = server.ptyFactory.latestProcess();
  pty.emitData("[sudo] password for user: ");

  const banner = page.locator(".tm-prompt-banner");
  await expect(banner).toBeVisible({ timeout: 10_000 });
  const input = banner.locator("input[type='password']");
  await expect(input).toBeVisible();

  const baseline = pty.writes.length;
  await input.fill("hunter2");
  await input.press("Enter");
  await expect
    .poll(() => pty.writes.slice(baseline).join(""), { timeout: 5_000 })
    .toBe("hunter2\r");
});

test("password_prompt: Cancel button sends Ctrl+C instead of the secret", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.waitForTimeout(400);

  const pty = server.ptyFactory.latestProcess();
  pty.emitData("password: ");

  const banner = page.locator(".tm-prompt-banner");
  await expect(banner).toBeVisible({ timeout: 10_000 });

  const baseline = pty.writes.length;
  await banner.getByRole("button", { name: /取消|Cancel/i }).click();
  await expect.poll(() => pty.writes.slice(baseline).join(""), { timeout: 5_000 }).toBe("\x03");
});

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

const DIRECT_MODE_ENTER_RE = /进入直通模式|Enter Direct Mode/i;
const DIRECT_MODE_EXIT_RE = /退出直通|Exit Direct Mode/i;

test("desktop: Direct Mode toggle button is visible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await expect(page.getByRole("button", { name: DIRECT_MODE_ENTER_RE })).toBeVisible();
});

test("regression: active Direct Mode keeps .tm-scroller sharp while sibling chrome blurs", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.getByRole("button", { name: DIRECT_MODE_ENTER_RE }).click();
  await expect(page.locator("body")).toHaveAttribute("data-direct-mode", "active", {
    timeout: 2000
  });

  // .tm-scroller itself AND every ancestor up to <body> must have filter=none.
  // A single blurred ancestor would render the terminal subtree blurred even
  // though the scroller has no direct filter.
  const scrollerChainFilters = await page.evaluate(() => {
    const out: string[] = [];
    let el: HTMLElement | null = document.querySelector(".tm-scroller");
    while (el && el !== document.body.parentElement) {
      out.push(getComputedStyle(el).filter);
      el = el.parentElement;
    }
    return out;
  });
  for (const f of scrollerChainFilters) {
    expect(f === "none" || f === "").toBe(true);
  }

  // Meanwhile at least one [data-dm-blur] container must have a blur filter.
  const blurredFilters = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-dm-blur]")).map(
      (el) => getComputedStyle(el as HTMLElement).filter
    )
  );
  expect(blurredFilters.some((f) => /blur/.test(f))).toBe(true);
});

test("clicking toggle sets body[data-direct-mode=active] after transition", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.getByRole("button", { name: DIRECT_MODE_ENTER_RE }).click();
  await expect(page.locator("body")).toHaveAttribute("data-direct-mode", /active|entering/, {
    timeout: 1000
  });
  await expect(page.locator(".tm-direct-mode-indicator")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-direct-mode", "active", {
    timeout: 1000
  });
});

test("keystrokes forward to PTY while active", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  const pty = server.ptyFactory.latestProcess();

  await page.getByRole("button", { name: DIRECT_MODE_ENTER_RE }).click();
  await expect(page.locator("body")).toHaveAttribute("data-direct-mode", "active", {
    timeout: 2000
  });

  const baseline = pty.writes.length;
  await page.keyboard.press("l");
  await page.keyboard.press("s");
  await page.keyboard.press("Enter");

  await expect.poll(() => pty.writes.slice(baseline).join(""), { timeout: 5_000 }).toBe("ls\r");
});

test('Ctrl+c sends \\x03 (not "c") while active', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  const pty = server.ptyFactory.latestProcess();

  await page.getByRole("button", { name: DIRECT_MODE_ENTER_RE }).click();
  await expect(page.locator("body")).toHaveAttribute("data-direct-mode", "active", {
    timeout: 2000
  });

  const baseline = pty.writes.length;
  await page.keyboard.press("Control+c");
  await expect.poll(() => pty.writes.slice(baseline).join(""), { timeout: 5_000 }).toBe("\x03");
});

test("Ctrl+] exits Direct Mode (no byte sent)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  const pty = server.ptyFactory.latestProcess();

  await page.getByRole("button", { name: DIRECT_MODE_ENTER_RE }).click();
  await expect(page.locator("body")).toHaveAttribute("data-direct-mode", "active", {
    timeout: 2000
  });

  const baseline = pty.writes.length;
  await page.keyboard.press("Control+]");
  await expect(page.locator("body")).not.toHaveAttribute("data-direct-mode", /./, {
    timeout: 1500
  });
  // No bytes sent for the exit key itself.
  expect(pty.writes.slice(baseline).join("")).toBe("");
});

test("exit indicator button also exits", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.getByRole("button", { name: DIRECT_MODE_ENTER_RE }).click();
  await expect(page.locator(".tm-direct-mode-indicator")).toBeVisible();
  await page
    .locator(".tm-direct-mode-indicator")
    .getByRole("button", { name: DIRECT_MODE_EXIT_RE })
    .click();
  await expect(page.locator(".tm-direct-mode-indicator")).toHaveCount(0, {
    timeout: 1500
  });
});

test("mobile viewport: toggle button is NOT shown", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole("button", { name: DIRECT_MODE_ENTER_RE })).toHaveCount(0);
});

test("mobile with ?direct_mode=1 shows toggle (URL override) and auto-enters", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "&direct_mode=1");
  // direct_mode=1 auto-enters; indicator appears and toggle reads "exit".
  await expect(page.locator(".tm-direct-mode-indicator")).toBeVisible({
    timeout: 3000
  });
  // ComposeBar toggle (not the indicator's exit button) also flipped to "exit".
  const toggle = page.getByTestId("compose-direct-mode");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAccessibleName(DIRECT_MODE_EXIT_RE);
});

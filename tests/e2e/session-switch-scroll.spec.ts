import { expect, test } from "@playwright/test";
import { startE2EServer, type StartedE2EServer } from "./harness/test-server.js";

let server: StartedE2EServer;

test.beforeEach(async () => {
  server = await startE2EServer({
    sessions: ["alpha", "beta"],
    attachedSession: "alpha",
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
  await expect
    .poll(() => server.ptyFactory.processes.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
};

test("regression: switching away from an alt-screen session releases alt-screen", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.waitForTimeout(400);

  // Drive the first PTY (attached to alpha) into alt-screen. This is what
  // happens when vim/htop/claude run full-screen: tmux forwards the
  // ESC[?1049h that the pane emits. xterm swaps to the alternate buffer
  // and our Surface paints the "alt-screen · scrollback paused" banner.
  const pty = server.ptyFactory.latestProcess();
  pty.emitData("\x1b[?1049h\x1b[2J\x1b[HFULL-SCREEN APP");

  await expect(page.locator(".tm-alt-banner")).toBeVisible({ timeout: 5_000 });

  // Switch to beta. The backend emits a `scrollback` control message whose
  // paneId is the active pane of beta — different from alpha's. Our
  // paneId-change watcher in use-terminal.ts calls term.reset() on detecting
  // that, which releases xterm from the alt buffer. Without this fix xterm
  // stayed in alt forever: spacer locked at 0, scroll unreachable.
  await page.getByTestId("session-list").locator('[data-session="beta"]').click();

  await expect(page.locator(".tm-alt-banner")).toHaveCount(0, { timeout: 5_000 });
});

test("regression: switching sessions writes the new seed so user can scroll into history immediately", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.waitForTimeout(400);

  // Put alpha in alt-screen.
  const pty = server.ptyFactory.latestProcess();
  pty.emitData("\x1b[?1049h\x1b[2J\x1b[HALT SCREEN ON ALPHA");
  await expect(page.locator(".tm-alt-banner")).toBeVisible({ timeout: 5_000 });

  // Switch to beta. Our fix releases alt AND writes beta's scrollback seed
  // (FakeTmuxGateway.capturePane returns 40 lines of `scrollback-line-N`),
  // so spacer is immediately non-zero — user can scroll up into history
  // without having to generate new content first.
  await page.getByTestId("session-list").locator('[data-session="beta"]').click();
  await expect(page.locator(".tm-alt-banner")).toHaveCount(0, { timeout: 5_000 });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const el = document.querySelector(".tm-spacer") as HTMLElement | null;
          return el ? el.getBoundingClientRect().height : 0;
        }),
      { timeout: 5_000 }
    )
    .toBeGreaterThan(0);

  // Scrolling up brings seed content into view.
  const scrollable = await page.evaluate(() => {
    const s = document.querySelector(".tm-scroller") as HTMLElement | null;
    if (!s) return 0;
    s.scrollTop = 0;
    return s.scrollHeight - s.clientHeight;
  });
  expect(scrollable).toBeGreaterThan(0);
});

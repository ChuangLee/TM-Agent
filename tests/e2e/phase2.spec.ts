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

const login = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.goto(`${server.baseUrl}/?token=${server.token}`);
  await page.getByPlaceholder("password").fill("letmein");
  await page.getByRole("button", { name: /unlock/i }).click();
  await expect(page.getByTestId("tm-rows")).toBeVisible({ timeout: 10_000 });
};

test("scrollback seed renders rows and makes the scroller scrollable", async ({ page }) => {
  await login(page);

  // ADR-0005: rows render directly from buffer.active (no mirror, no canvas).
  // Once seeded, scrollHeight > clientHeight confirms the spacer is sized off
  // the xterm buffer, not pinned to the viewport.
  const scroller = page.getByTestId("tm-scroller");
  const rows = page.getByTestId("tm-rows");
  await expect(scroller).toBeVisible();
  await expect(rows).toBeVisible();

  await expect.poll(() => rows.locator(".tm-row").count(), { timeout: 10_000 }).toBeGreaterThan(0);

  await expect
    .poll(async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), {
      timeout: 10_000
    })
    .toBeGreaterThan(0);
});

test("backend invokes capturePane with escapes + full pane on attach", async ({ page }) => {
  await login(page);

  // Seed must include SGR (`:e`) AND include the currently-visible pane (no
  // `:hist` suffix). Earlier we captured scrollback only ("historyOnly"),
  // which left xterm's viewport showing the OLDEST scrollback rows in the
  // last `rows` lines — tmux's grouped-session attach doesn't full-redraw
  // the pane for us, so users saw stale scrollback where the live pane
  // should be.
  await expect
    .poll(
      () =>
        server.tmux.calls.filter(
          (c) => c.startsWith("capturePane:") && c.endsWith(":e") && !c.endsWith(":hist")
        ).length,
      { timeout: 10_000 }
    )
    .toBeGreaterThan(0);
});

test("rendered rows expose plain DOM text for native selection", async ({ page }) => {
  await login(page);

  // ADR-0005 replaces the freeze+select dance (ADR-0003) with always-on
  // native selection: every row is real DOM text under `user-select: text`.
  // Verify we can read a row's textContent — something xterm's canvas
  // renderer never allowed. This guards against regressing back to a canvas
  // or shadow-dom renderer.
  const rows = page.getByTestId("tm-rows");
  await expect.poll(() => rows.locator(".tm-row").count(), { timeout: 10_000 }).toBeGreaterThan(0);

  const selectable = await rows.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.userSelect === "text" || style.webkitUserSelect === "text";
  });
  expect(selectable).toBe(true);

  // Exercise a Selection API round-trip so we know the DOM is real text,
  // not a canvas or transparent overlay.
  const selectedText = await page.evaluate(() => {
    const row = document.querySelector(".tm-rows .tm-row");
    if (!row) return "";
    const range = document.createRange();
    range.selectNodeContents(row);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return sel?.toString() ?? "";
  });
  expect(selectedText.length).toBeGreaterThan(0);
});

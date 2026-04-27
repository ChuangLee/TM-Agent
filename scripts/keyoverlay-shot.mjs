#!/usr/bin/env node
/**
 * Capture the mobile KeyOverlay in its open state so we can eyeball the
 * glass treatment. Drives the deployment at $TM_AGENT_HOST with an iPhone
 * viewport, opens the overlay via the TopBar ⌨ button, and writes a
 * screenshot to debug/keyoverlay-glass-<ts>.png.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readEnvFile = () => {
  const env = {
    TM_AGENT_HOST: process.env.TM_AGENT_HOST || "http://localhost:5173",
    TM_AGENT_TOKEN: process.env.TM_AGENT_TOKEN || "",
    TM_AGENT_PASSWORD: process.env.TM_AGENT_PASSWORD || ""
  };
  try {
    const raw = execSync("sudo -n cat /etc/tm-agent/env 2>/dev/null", {
      encoding: "utf8"
    });
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  } catch {
    /* env file optional */
  }
  return env;
};

const main = async () => {
  const env = readEnvFile();
  const host = env.TM_AGENT_HOST;
  const token = env.TM_AGENT_TOKEN;
  const password = env.TM_AGENT_PASSWORD;
  if (!token) throw new Error("missing TM_AGENT_TOKEN (set env var or /etc/tm-agent/env)");

  const ts = Date.now();
  const out = path.resolve(ROOT, `debug/keyoverlay-glass-${ts}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3
  });
  const page = await context.newPage();

  await page.goto(`${host}/?token=${encodeURIComponent(token)}`, { waitUntil: "domcontentloaded" });
  if (password) {
    const input = page.getByPlaceholder("password");
    if (await input.count()) {
      await input.fill(password);
      await page.getByRole("button", { name: /unlock/i }).click();
    }
  }

  await page.waitForSelector(".tm-rows", { timeout: 10_000 });
  await page.waitForTimeout(1500);

  // Type something so shell content is visible under the overlay.
  await page.locator(".tm-scroller").click();
  await page.keyboard.type("ls -la /etc | head -25", { delay: 15 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);

  await page.locator('[data-testid="topbar-key-overlay"]').click();
  await page.waitForTimeout(400);

  // Arm Ctrl so the letter grid shows too (fuller glass surface).
  await page.locator('.tm-overlay-mod[data-mod="ctrl"]').click();
  await page.waitForTimeout(300);

  await page.screenshot({ path: out, fullPage: false });
  console.log(out);
  await browser.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

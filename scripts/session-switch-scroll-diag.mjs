import { chromium } from "playwright";
import { execSync } from "node:child_process";

const env = (() => {
  try {
    const raw = execSync("sudo -n cat /etc/tm-agent/env 2>/dev/null", { encoding: "utf8" });
    const out = {};
    for (const l of raw.split("\n")) {
      const m = l.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
})();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const host = process.env.TM_AGENT_HOST || "http://localhost:5173";
await page.goto(`${host}/?token=${env.TM_AGENT_TOKEN}&_cb=${Date.now()}`);
if (env.TM_AGENT_PASSWORD) {
  const pw = page.getByPlaceholder("password");
  if (await pw.count()) {
    await pw.fill(env.TM_AGENT_PASSWORD);
    await page.getByRole("button", { name: /unlock/i }).click();
  }
}
await page.waitForSelector(".tm-rows", { timeout: 15000 });
await page.waitForTimeout(3000);

const probe = async (label) => {
  const state = await page.evaluate(() => {
    const s = document.querySelector(".tm-scroller");
    const spacer = document.querySelector(".tm-spacer");
    return {
      scrollTop: s?.scrollTop,
      scrollHeight: s?.scrollHeight,
      clientHeight: s?.clientHeight,
      spacerHeight: spacer?.getBoundingClientRect().height,
      altBanner: !!document.querySelector(".tm-alt-banner")
    };
  });
  const before = state.scrollTop;
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector(".tm-scroller").scrollTop);
  console.log(`[${label}] state=`, JSON.stringify(state), ` wheel: ${before} → ${after}`);
};

const switchSession = async (name) => {
  console.log(`\n--- switching to ${name} ---`);
  const btn = page.locator(`aside button:has-text("${name}")`).first();
  await btn.click();
  await page.waitForTimeout(2500);
};

console.log("\n=== BOOT ===");
await probe("initial");

await switchSession("netsec");
await probe("after-switch-to-netsec");

await switchSession("post");
await probe("after-switch-to-post");

await switchSession("mtmux");
await probe("after-switch-back-to-mtmux");

// NOTE: do not add a "type a command" step here. This script runs against
// a live deployment and would inject real keystrokes into the user's
// sessions. Observe scroll behavior passively only.

await browser.close();

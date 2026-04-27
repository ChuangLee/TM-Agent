import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";

const env = (() => {
  const out = {
    TM_AGENT_HOST: process.env.TM_AGENT_HOST || "http://localhost:5173",
    TM_AGENT_TOKEN: process.env.TM_AGENT_TOKEN || "",
    TM_AGENT_PASSWORD: process.env.TM_AGENT_PASSWORD || ""
  };
  try {
    const raw = execSync("sudo -n cat /etc/tm-agent/env 2>/dev/null", { encoding: "utf8" });
    for (const l of raw.split("\n")) {
      const m = l.match(/^([A-Z_]+)=(.*)$/);
      if (m && !out[m[1]]) out[m[1]] = m[2];
    }
  } catch {
    /* env file optional */
  }
  return out;
})();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  ...devices["iPhone 14 Pro"]
});
const page = await ctx.newPage();

await page.goto(`${env.TM_AGENT_HOST}/?token=${env.TM_AGENT_TOKEN}&_cb=${Date.now()}`);
if (env.TM_AGENT_PASSWORD) {
  const pw = page.getByPlaceholder("password");
  if (await pw.count()) {
    await pw.fill(env.TM_AGENT_PASSWORD);
    await page.getByRole("button", { name: /unlock/i }).click();
  }
}
await page.waitForSelector(".tm-rows", { timeout: 15000 });
await page.waitForTimeout(2000);

// Baseline: capture root height, viewport, and --app-height CSS var
const baseline = await page.evaluate(() => {
  const html = document.documentElement;
  const root = document.getElementById("root");
  return {
    appHeight: getComputedStyle(html).getPropertyValue("--app-height").trim(),
    rootHeightPx: root?.getBoundingClientRect().height,
    innerHeight: window.innerHeight,
    vvHeight: window.visualViewport?.height,
    dvh: getComputedStyle(document.documentElement).getPropertyValue("height").trim(),
    viewportMeta: document.querySelector("meta[name=viewport]")?.getAttribute("content")
  };
});
console.log("baseline:", JSON.stringify(baseline, null, 2));

// Simulate virtual keyboard rise by resizing visualViewport via CDP
// (Chromium headless lacks a real virtual keyboard; we resize the context instead)
console.log("\n--- simulating keyboard rise: context resize 390x500 ---");
await page.setViewportSize({ width: 390, height: 500 });
await page.waitForTimeout(300);

const afterResize = await page.evaluate(() => {
  const html = document.documentElement;
  const root = document.getElementById("root");
  return {
    appHeight: getComputedStyle(html).getPropertyValue("--app-height").trim(),
    rootHeightPx: root?.getBoundingClientRect().height,
    innerHeight: window.innerHeight,
    vvHeight: window.visualViewport?.height
  };
});
console.log("after keyboard-rise sim:", JSON.stringify(afterResize, null, 2));

// Resize back to full
console.log("\n--- keyboard dismiss: back to 390x844 ---");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);

const afterDismiss = await page.evaluate(() => {
  const html = document.documentElement;
  const root = document.getElementById("root");
  return {
    appHeight: getComputedStyle(html).getPropertyValue("--app-height").trim(),
    rootHeightPx: root?.getBoundingClientRect().height
  };
});
console.log("after dismiss:", JSON.stringify(afterDismiss, null, 2));

await browser.close();

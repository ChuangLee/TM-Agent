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
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  // Bypass cache to ensure we hit latest bundle
  bypassCSP: true
});
const page = await ctx.newPage();

// Force cache bust with random URL param
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

// Record scrollTop every 200ms for 2 seconds of wheel-up attempts
const samples = await page.evaluate(async () => {
  const s = document.querySelector(".tm-scroller");
  // emulate continuous wheel upward
  const out = [];
  const start = Date.now();
  out.push({ t: 0, scrollTop: s.scrollTop });
  for (let i = 0; i < 10; i++) {
    const evt = new WheelEvent("wheel", { deltaY: -150, bubbles: true, cancelable: true });
    s.dispatchEvent(evt);
    // Also set scrollTop directly as a backup
    // s.scrollTop -= 150;
    await new Promise((r) => setTimeout(r, 150));
    out.push({
      t: Date.now() - start,
      scrollTop: s.scrollTop,
      evtDefaultPrevented: evt.defaultPrevented
    });
  }
  return out;
});
console.log(JSON.stringify(samples, null, 2));

// Also try the real hovered mouse wheel
const before = await page.evaluate(() => document.querySelector(".tm-scroller").scrollTop);
for (let i = 0; i < 5; i++) {
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);
}
const after = await page.evaluate(() => document.querySelector(".tm-scroller").scrollTop);
console.log("mouse.wheel 5 * -300: scrollTop", before, "->", after, "(diff", after - before, ")");

await browser.close();

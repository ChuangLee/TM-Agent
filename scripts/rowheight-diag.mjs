import { chromium } from "playwright";
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
await page.waitForTimeout(3000);

const detailedProbe = async (label) => {
  const state = await page.evaluate(() => {
    const scroller = document.querySelector(".tm-scroller");
    const rows = document.querySelector(".tm-rows");
    const viewport = document.querySelector(".tm-viewport");
    const rowsArr = Array.from(rows?.children || []);

    // Measure EVERY row's actual rendered height and compute the avg + delta
    const rowHeights = rowsArr.map((r) => r.getBoundingClientRect().height);
    const avgH = rowHeights.reduce((a, b) => a + b, 0) / rowHeights.length;
    const uniqueH = [...new Set(rowHeights)];

    // Cell-metrics from CSS var vs measured
    const docStyle = getComputedStyle(document.documentElement);
    const cssLineHeight = docStyle.getPropertyValue("--term-line-height").trim();

    // Font stack and what's actually used
    const firstRow = rowsArr[0];
    const rowFontFamily = firstRow ? getComputedStyle(firstRow).fontFamily : null;
    const rowFontSize = firstRow ? getComputedStyle(firstRow).fontSize : null;

    return {
      scrollerH: scroller?.getBoundingClientRect().height,
      scrollerClientH: scroller?.clientHeight,
      viewportH: viewport?.getBoundingClientRect().height,
      rowsH: rows?.getBoundingClientRect().height,
      rowCount: rowsArr.length,
      cssLineHeight,
      uniqueRowHeights: uniqueH,
      avgRowH: avgH,
      sumRowH: avgH * rowsArr.length,
      overflowPx: avgH * rowsArr.length - scroller?.clientHeight,
      rowFontFamily,
      rowFontSize,
      fontStack: docStyle.getPropertyValue("font-family").trim()
    };
  });
  console.log(`\n[${label}]`, JSON.stringify(state, null, 2));
};

await detailedProbe("initial");

console.log("\n--- click netsec ---");
await page.locator(`aside button:has-text("netsec")`).first().click();
await page.waitForTimeout(1000);
await detailedProbe("switch @1s");
await page.waitForTimeout(3000);
await detailedProbe("switch @4s");

await browser.close();

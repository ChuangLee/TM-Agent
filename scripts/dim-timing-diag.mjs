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

// Poll tmrows / scroller every 100ms for 8 seconds, after initial attach
const recordLoop = async (label, duration) => {
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < duration) {
    const s = await page.evaluate(() => {
      const scroller = document.querySelector(".tm-scroller");
      const rows = document.querySelector(".tm-rows");
      if (!scroller || !rows) return null;
      const rowsArr = Array.from(rows.children);
      const firstRow = rowsArr[0];
      const lastRow = rowsArr[rowsArr.length - 1];
      return {
        scrollerClientW: scroller.clientWidth,
        scrollerClientH: scroller.clientHeight,
        rowCount: rowsArr.length,
        firstRowTop: firstRow?.getBoundingClientRect().top,
        lastRowBottom: lastRow?.getBoundingClientRect().bottom,
        rowH: firstRow?.getBoundingClientRect().height,
        scrollTop: scroller.scrollTop,
        spacerH: document.querySelector(".tm-spacer")?.getBoundingClientRect().height
      };
    });
    samples.push({ t: Date.now() - start, ...s });
    await page.waitForTimeout(200);
  }
  console.log(`\n[${label}] timeline (t in ms):`);
  for (const s of samples) {
    console.log(
      `  t=${s.t.toString().padStart(4)} ` +
        `W=${s.scrollerClientW} H=${s.scrollerClientH} ` +
        `rows=${s.rowCount} rowH=${s.rowH} ` +
        `firstTop=${s.firstRowTop} lastBot=${s.lastRowBottom} ` +
        `spacer=${s.spacerH} scrollTop=${s.scrollTop}`
    );
  }
};

await recordLoop("INITIAL (0-5s)", 5000);

console.log("\n--- click netsec ---");
await page.locator(`aside button:has-text("netsec")`).first().click();
await recordLoop("AFTER SWITCH netsec (0-8s)", 8000);

console.log("\n--- click mtmux ---");
await page.locator(`aside button:has-text("mtmux")`).first().click();
await recordLoop("AFTER SWITCH BACK mtmux (0-8s)", 8000);

await browser.close();

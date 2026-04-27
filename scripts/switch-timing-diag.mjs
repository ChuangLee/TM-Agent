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
await page.waitForTimeout(2000);

const snapshot = async () =>
  page.evaluate(() => {
    const s = document.querySelector(".tm-scroller");
    const rows = document.querySelector(".tm-rows");
    const firstRow = rows?.children[0];
    const lastRow = rows?.children[rows.children.length - 1];
    const scrollerRect = s?.getBoundingClientRect();
    const rowsRect = rows?.getBoundingClientRect();
    return {
      scrollerW: scrollerRect?.width,
      scrollerH: scrollerRect?.height,
      scrollerClientW: s?.clientWidth,
      scrollerClientH: s?.clientHeight,
      rowsW: rowsRect?.width,
      rowsH: rowsRect?.height,
      rowCount: rows?.children.length,
      firstRowH: firstRow?.getBoundingClientRect().height,
      lastRowH: lastRow?.getBoundingClientRect().height,
      lastRowBottom: lastRow?.getBoundingClientRect().bottom,
      lastRowText: lastRow?.textContent?.slice(0, 60),
      spacerH: document.querySelector(".tm-spacer")?.getBoundingClientRect().height
    };
  });

console.log("--- initial ---");
console.log(JSON.stringify(await snapshot(), null, 2));
await page.waitForTimeout(3000);
console.log("--- after 3s (initial settled) ---");
console.log(JSON.stringify(await snapshot(), null, 2));

console.log("\n--- switching to netsec ---");
const btn = page.locator(`aside button:has-text("netsec")`).first();
await btn.click();

for (const delay of [200, 500, 1000, 2000, 4000, 6000]) {
  await page.waitForTimeout(
    delay -
      (delay === 200
        ? 0
        : delay === 500
          ? 200
          : delay === 1000
            ? 500
            : delay === 2000
              ? 1000
              : delay === 4000
                ? 2000
                : 4000)
  );
  const s = await snapshot();
  console.log(
    `[@${delay}ms] scrollerClientW=${s.scrollerClientW} rowsW=${s.rowsW} rowCount=${s.rowCount} lastRowBottom=${s.lastRowBottom} scrollerH=${s.scrollerH} spacerH=${s.spacerH}`
  );
}

await browser.close();

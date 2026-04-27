// Live diagnostic: captures buffer vs DOM state at fixed intervals after a session switch.
// Flags rows where DOM !== buffer rendering, or rows that appear "blank" unexpectedly.
// Does NOT type into the compose bar — pure observation.
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

page.on("console", (m) => {
  const t = m.text();
  if (t.includes("[tm-agent:")) console.log("  console>", t);
});

const host = process.env.TM_AGENT_HOST || "http://localhost:5173";
await page.goto(`${host}/?token=${env.TM_AGENT_TOKEN}&debug=1&_cb=${Date.now()}`);
if (env.TM_AGENT_PASSWORD) {
  const pw = page.getByPlaceholder("password");
  if (await pw.count()) {
    await pw.fill(env.TM_AGENT_PASSWORD);
    await page.getByRole("button", { name: /unlock/i }).click();
  }
}
await page.waitForSelector(".tm-rows", { timeout: 15000 });
await page.waitForTimeout(3000);

const snap = async (label) => {
  const state = await page.evaluate(() => {
    const scroller = document.querySelector(".tm-scroller");
    const rows = document.querySelector(".tm-rows");
    const spacer = document.querySelector(".tm-spacer");
    const rowEls = Array.from(rows?.children || []);
    const domRows = rowEls.map((r) => (r.textContent || "").trimEnd());

    // Pull buffer content from terminal instance if exposed on window
    // (otherwise compare against domRows visually)
    const firstBlankFromBottom = (() => {
      for (let i = domRows.length - 1; i >= 0; i--) {
        if (domRows[i].trim() !== "") return i + 1; // i+1 = first content row from bottom
      }
      return 0;
    })();

    // Count trailing blanks
    let trailingBlanks = 0;
    for (let i = domRows.length - 1; i >= 0; i--) {
      if (domRows[i].trim() === "") trailingBlanks++;
      else break;
    }

    return {
      rowCount: domRows.length,
      trailingBlanks,
      firstBlankFromBottom,
      scrollerH: scroller?.clientHeight,
      spacerH: spacer?.offsetHeight,
      scrollTop: scroller?.scrollTop,
      scrollHeight: scroller?.scrollHeight,
      lastContentRows: domRows
        .slice(-8)
        .map(
          (r, i) => `  [${domRows.length - 8 + i}] "${r.slice(0, 40)}${r.length > 40 ? "…" : ""}"`
        )
    };
  });
  console.log(`\n[${label}]`);
  console.log(`  rowCount=${state.rowCount}, trailingBlanks=${state.trailingBlanks}`);
  console.log(
    `  scroller H=${state.scrollerH}, spacer=${state.spacerH}, scrollTop=${state.scrollTop}, scrollH=${state.scrollHeight}`
  );
  console.log(`  last 8 rows:`);
  for (const r of state.lastContentRows) console.log(r);
};

await snap("initial (after 3s)");

console.log("\n--- click netsec ---");
await page.locator(`aside button:has-text("netsec")`).first().click();

await page.waitForTimeout(500);
await snap("switch @0.5s");
await page.waitForTimeout(1500);
await snap("switch @2s");
await page.waitForTimeout(3000);
await snap("switch @5s");
await page.waitForTimeout(3000);
await snap("switch @8s");

// Collect debug log buffer
const dump = await page.evaluate(() => {
  const fn = window.__tmuxDebugDump;
  if (typeof fn === "function") return fn();
  return null;
});
if (dump) {
  console.log(`\n--- debug buffer (${dump.length} events) ---`);
  for (const r of dump) {
    console.log(`  +${r.t}ms [${r.scope}] ${r.label}${r.data ? " " + JSON.stringify(r.data) : ""}`);
  }
}

await browser.close();

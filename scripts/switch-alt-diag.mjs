// Reproduces user's reported switch bug by bouncing through an alt-screen session.
// Read-only: never types into compose bar.
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

    let trailingBlanks = 0;
    for (let i = domRows.length - 1; i >= 0; i--) {
      if (domRows[i].trim() === "") trailingBlanks++;
      else break;
    }

    // Peek xterm buffer if global exposed
    const w = window;
    const buf = w.__tmuxTerm ? w.__tmuxTerm.buffer.active : null;
    const bufSummary = buf
      ? {
          type: buf.type,
          length: buf.length,
          cursorY: buf.cursorY,
          baseY: buf.baseY,
          lastRowsFromBuffer: Array.from({ length: 8 }, (_, i) => {
            const y = buf.length - 8 + i;
            const line = buf.getLine(y);
            return line ? line.translateToString(false).trimEnd() : null;
          })
        }
      : null;

    return {
      altBanner: !!document.querySelector("[data-alt-banner]"),
      rowCount: domRows.length,
      trailingBlanks,
      scrollerH: scroller?.clientHeight,
      spacerH: spacer?.offsetHeight,
      scrollTop: scroller?.scrollTop,
      scrollHeight: scroller?.scrollHeight,
      lastRowsDom: domRows
        .slice(-8)
        .map(
          (r, i) => `[${domRows.length - 8 + i}] "${r.slice(0, 60)}${r.length > 60 ? "…" : ""}"`
        ),
      bufSummary
    };
  });
  console.log(
    `\n[${label}] scrollerH=${state.scrollerH} spacerH=${state.spacerH} scrollTop=${state.scrollTop} scrollH=${state.scrollHeight} trailingBlanks=${state.trailingBlanks} altBanner=${state.altBanner}`
  );
  console.log("  dom last 8 rows:");
  for (const r of state.lastRowsDom) console.log("   ", r);
  if (state.bufSummary) {
    console.log(
      `  buffer: type=${state.bufSummary.type} length=${state.bufSummary.length} cursorY=${state.bufSummary.cursorY} baseY=${state.bufSummary.baseY}`
    );
    console.log(`  buf last 8 rows:`);
    for (let i = 0; i < state.bufSummary.lastRowsFromBuffer.length; i++) {
      const row = state.bufSummary.lastRowsFromBuffer[i];
      console.log(
        `    [${state.bufSummary.length - 8 + i}] ${row === null ? "<null>" : `"${(row || "").slice(0, 60)}"`}`
      );
    }
  } else {
    console.log("  buffer: <not exposed on window>");
  }
};

// List available session buttons
const sessions = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("aside button")).map((b) => b.textContent?.trim());
});
console.log("Available session buttons:", sessions);

await snap("initial (3s after load)");

// Switch to netsec, then nthux, then back
const clickSession = async (name) => {
  await page.locator(`aside button:has-text("${name}")`).first().click();
};

console.log("\n--- switch -> netsec1w ---");
await clickSession("netsec1w");
await page.waitForTimeout(500);
await snap("netsec1w @0.5s");
await page.waitForTimeout(2000);
await snap("netsec1w @2.5s");

console.log("\n--- switch -> mtmux1w ---");
await clickSession("mtmux1w");
await page.waitForTimeout(500);
await snap("mtmux1w @0.5s");
await page.waitForTimeout(2000);
await snap("mtmux1w @2.5s");
await page.waitForTimeout(3000);
await snap("mtmux1w @5.5s");

console.log("\n--- switch -> netsec1w (second time) ---");
await clickSession("netsec1w");
await page.waitForTimeout(500);
await snap("netsec1w-2 @0.5s");
await page.waitForTimeout(2000);
await snap("netsec1w-2 @2.5s");
await page.waitForTimeout(3000);
await snap("netsec1w-2 @5.5s");

const dump = await page.evaluate(() => {
  const fn = window.__tmuxDebugDump;
  return typeof fn === "function" ? fn() : null;
});
if (dump) {
  console.log(`\n--- debug buffer (${dump.length} events) ---`);
  for (const r of dump) {
    console.log(`  +${r.t}ms [${r.scope}] ${r.label}${r.data ? " " + JSON.stringify(r.data) : ""}`);
  }
}

await browser.close();

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";

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

const outDir = "/tmp/tmux-visual-diag";
fs.mkdirSync(outDir, { recursive: true });

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

// Focus on bottom 300px where the bug is reported
const clip = { x: 300, y: 500, width: 980, height: 300 };

// Initial load snapshots at 500ms, 1s, 2s, 5s
for (const t of [500, 1000, 2000, 5000]) {
  await page.waitForTimeout(t === 500 ? 500 : t === 1000 ? 500 : t === 2000 ? 1000 : 3000);
  await page.screenshot({ path: `${outDir}/initial-${t}ms.png`, clip });
  console.log(`initial-${t}ms.png`);
}

// Diagnostic data
const diagAt = async (label) => {
  const s = await page.evaluate(() => {
    const scroller = document.querySelector(".tm-scroller");
    const rows = document.querySelector(".tm-rows");
    const allRows = Array.from(rows?.children || []).map((r) => ({
      h: r.getBoundingClientRect().height,
      bottom: r.getBoundingClientRect().bottom,
      text: r.textContent?.slice(0, 40)
    }));
    return {
      scrollerH: scroller?.getBoundingClientRect().height,
      rowCount: rows?.children.length,
      lastFiveRows: allRows.slice(-5)
    };
  });
  console.log(`[${label}]`, JSON.stringify(s, null, 2));
};

await diagAt("initial @5s");

console.log("\n--- switching to netsec ---");
await page.locator(`aside button:has-text("netsec")`).first().click();

for (const t of [200, 500, 1000, 2000, 5000, 8000]) {
  await page.waitForTimeout(
    t === 200
      ? 200
      : t === 500
        ? 300
        : t === 1000
          ? 500
          : t === 2000
            ? 1000
            : t === 5000
              ? 3000
              : 3000
  );
  await page.screenshot({ path: `${outDir}/switch-netsec-${t}ms.png`, clip });
  console.log(`switch-netsec-${t}ms.png`);
}

await diagAt("switched netsec @8s");

console.log("\n--- switching back to mtmux ---");
await page.locator(`aside button:has-text("mtmux")`).first().click();

for (const t of [200, 500, 1000, 2000, 5000, 8000]) {
  await page.waitForTimeout(
    t === 200
      ? 200
      : t === 500
        ? 300
        : t === 1000
          ? 500
          : t === 2000
            ? 1000
            : t === 5000
              ? 3000
              : 3000
  );
  await page.screenshot({ path: `${outDir}/switch-back-${t}ms.png`, clip });
  console.log(`switch-back-${t}ms.png`);
}

await diagAt("switched back @8s");

await browser.close();
console.log(`\nScreenshots in ${outDir}`);

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { readFileSync, mkdirSync } from "node:fs";
const cards = JSON.parse(readFileSync("manifest.json", "utf8"));
mkdirSync("out", { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 1200, height: 2000 }, deviceScaleFactor: 1 })).newPage();
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("file://" + process.cwd() + "/cards.html", { waitUntil: "load" });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(700);

// Confirm the brand fonts really loaded — a silent fallback to DejaVu would
// wreck every headline's spacing.
console.log("fonts:", await p.evaluate(() =>
  ["Space Grotesk", "Inter", "JetBrains Mono"].map(f => f + "=" + document.fonts.check(`700 92px "${f}"`)).join(" ")));

for (const c of cards) {
  const el = p.locator("#" + c.id);
  const box = await el.boundingBox();
  if (Math.round(box.width) !== c.w || Math.round(box.height) !== c.h)
    throw new Error(`${c.id} is ${box.width}x${box.height}, expected ${c.w}x${c.h}`);
  // Overflow check: nothing may spill past the frame.
  const spill = await el.evaluate(e => {
    const r = e.getBoundingClientRect();
    let worst = -1e9;
    for (const n of e.querySelectorAll("*")) {
      const b = n.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      worst = Math.max(worst, b.bottom - r.bottom, b.right - r.right);
    }
    return Math.round(worst);
  });
  const MARGIN = -20;
  await el.screenshot({ path: `out/${c.id}.png` });
  console.log(`  ${c.id.padEnd(20)} ${c.w}x${c.h}  spill:${spill > MARGIN ? " ⚠ within " + (spill + 20) + "px of edge" : " ok (" + -spill + "px clear)"}`);
}
console.log("js errors:", errs.length ? errs : "none");
await b.close();

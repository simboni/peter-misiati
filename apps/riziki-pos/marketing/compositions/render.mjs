import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const DIR = process.cwd();  // run it from marketing/compositions
// node render.mjs ad-1-hero:1600:1000  …  (sizes are the stage's CSS size)
const jobs = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const j of jobs) {
  const [file, w, h] = j.split(':');
  const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`file://${DIR}/${file}.html`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const el = p.locator('.stage').first();
  await el.screenshot({ path: `../ads/${file}.png` });
  console.log('rendered', file, `${w}x${h}`);
  await ctx.close();
}
await b.close();

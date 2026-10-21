import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const grab = async (w, h, tag, dark) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:4300/', { waitUntil: 'networkidle' });
  if (dark) {
    await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await p.waitForTimeout(400);
  }
  // Scroll the whole page so every lazy image decodes before we shoot.
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(1200);
  const wall = p.locator('#proof');
  await wall.scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/wall-${tag}.png` });
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/top-${tag}.png` });
  if (errs.length) console.log(`  !! ${tag} JS errors:`, errs.slice(0,3));
  await ctx.close();
};
await grab(1440, 950, 'desktop', false);
await grab(1440, 950, 'desktop-dark', true);
await grab(390, 844, 'mobile', false);
await b.close();
console.log('shots written');

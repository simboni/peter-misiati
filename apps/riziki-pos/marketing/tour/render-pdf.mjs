import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const HERE = process.cwd();  // run it from marketing/tour
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 760, height: 1050 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const problems = [];
p.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
await p.goto(`file://${HERE}/print.html`, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);

const check = await p.evaluate(() => ({
  h1: getComputedStyle(document.querySelector('h1')).fontFamily,
  loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight),
  wide: [...document.querySelectorAll('body *')]
    .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 2)
    .slice(0, 4).map((e) => e.tagName + '.' + (typeof e.className === 'string' ? e.className.slice(0, 40) : '')),
  panes: [!!document.getElementById('pane-advance'), !document.getElementById('pane-order')?.hidden],
}));
console.log('fonts on h1:', check.h1);
console.log('faces loaded:', [...new Set(check.loaded)].join(' · '));
console.log('overflowing:', check.wide.length ? check.wide : 'none');
console.log('both recipe routes visible:', check.panes);
console.log('errors:', problems.length ? problems : 'none');

await p.pdf({
  path: `../riziki-pos-end-to-end.pdf`,
  format: 'A4',
  printBackground: true,
  margin: { top: '11mm', bottom: '13mm', left: '10mm', right: '10mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font:8.5px \'Helvetica\',sans-serif;color:#7b9499;padding:0 10mm;' +
    'display:flex;justify-content:space-between;">' +
    '<span>Riziki POS · how the system works, end to end</span>' +
    '<span class="pageNumber"></span></div>',
});
// a screen-width render of the same file, to eyeball the print layout once
await p.screenshot({ path: `print-look.png`, fullPage: false });
await b.close();

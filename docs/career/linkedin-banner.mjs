import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
const require = createRequire("/home/user/st-stephen-kimaeti/tools/x.js");
const { chromium } = require("playwright-core");
const DIR = "/tmp/claude-0/-home-user-peter-misiati/e5914bcd-466c-50c3-8d63-fcf9b51cb6c6/scratchpad";
const tpl = await readFile(`${DIR}/linkedin-banner.html`, "utf8");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
for (const theme of ["", "midnight"]) {
  const f = `${DIR}/_b-${theme || "dark"}.html`;
  await writeFile(f, tpl.replace("THEME", theme));
  const p = await b.newPage({ viewport: { width: 1584, height: 396 }, deviceScaleFactor: 2 });
  await p.goto("file://" + f, { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${DIR}/linkedin-${theme || "dark"}@2x.png` });
  await p.close();
  console.log("rendered", theme || "dark");
}
await b.close();

// Download the brand's fonts and inline them as data URIs, so the cards render
// with Space Grotesk / Inter / JetBrains Mono instead of a fallback.
import { readFileSync, writeFileSync } from "node:fs";
let css = readFileSync("fonts.css", "utf8");
// Keep only the latin subsets — the others are dead weight in a poster.
const blocks = css.split("@font-face").filter(b => b.includes("gstatic"));
const keep = [];
for (const b of blocks) {
  const before = css.slice(0, css.indexOf(b));
  const comment = [...before.matchAll(/\/\*\s*([a-z0-9-\[\]]+)\s*\*\//g)].pop();
  if (comment && comment[1] !== "latin") continue;
  keep.push("@font-face" + b);
}
let out = keep.join("\n");
const urls = [...new Set([...out.matchAll(/https:\/\/fonts\.gstatic\.com\/[^)]+woff2/g)].map(m => m[0]))];
console.log("latin faces:", keep.length, "unique files:", urls.length);
for (const u of urls) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(u + " -> " + r.status);
  const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
  out = out.split(u).join(`data:font/woff2;base64,${b64}`);
  process.stdout.write(".");
}
writeFileSync("fonts-inline.css", out);
console.log("\nwrote fonts-inline.css", (out.length / 1024).toFixed(0) + " KB");

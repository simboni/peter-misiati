#!/usr/bin/env node
/*
 * Rail thumbnails for the home-page galleries.
 *
 * Each project on the home page is one frame with a strip of thumbnails under
 * it. The strip is 144px wide at most; the screenshots behind it are 1400 to
 * 1600px. Pointing the strip at the full files means the browser downloads
 * every screen of every project the moment the wall scrolls into view — about
 * 800KB of pictures to draw sixteen postage stamps, on a site whose audience
 * is largely on a phone on a Kenyan mobile network.
 *
 * So the strip gets its own files: 320px wide, in `public/rail/`, flat and
 * named after the original. The full-size screen is then fetched only for the
 * one actually in the frame, and for whichever others get reached for.
 *
 * Run after adding or changing a shot in src/lib/showcase.ts:
 *
 *     node scripts/gallery-thumbs.mjs
 *
 * It needs `sharp`. That is not a declared dependency of this project — the
 * outputs are committed, and `npm run check:projects` fails the build if one
 * is missing, so nobody needs sharp installed just to build the site.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 320;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcase = fs.readFileSync(path.join(root, "src/lib/showcase.ts"), "utf8");

// Every `src:` in the showcase, in file order. Same regex approach as
// check-projects.mjs: the file is data, and parsing TypeScript to read a list
// of strings out of it would be a worse trade than this.
const srcs = [...showcase.matchAll(/^\s*src:\s*"(\/[^"]+)"/gm)].map((m) => m[1]);
if (srcs.length === 0) {
  console.error("gallery-thumbs: no shots found in src/lib/showcase.ts — has the shape changed?");
  process.exit(1);
}

// The rail directory is flat, so two shots may not share a basename.
const seen = new Map();
for (const src of srcs) {
  const base = path.basename(src);
  if (seen.has(base) && seen.get(base) !== src) {
    console.error(`gallery-thumbs: two different shots are both called ${base}:`);
    console.error(`  ${seen.get(base)}\n  ${src}`);
    console.error("Rename one — public/rail/ is flat and the second would overwrite the first.");
    process.exit(1);
  }
  seen.set(base, src);
}

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("gallery-thumbs: sharp is not installed. `npm i -D sharp`, run this, then remove it again if you like — the outputs are committed.");
  process.exit(1);
}

const outDir = path.join(root, "public/rail");
fs.mkdirSync(outDir, { recursive: true });

let written = 0;
let skipped = 0;
for (const [base, src] of seen) {
  const from = path.join(root, "public", src);
  if (!fs.existsSync(from)) {
    console.error(`gallery-thumbs: ${src} does not exist`);
    process.exit(1);
  }
  const to = path.join(outDir, base);
  // Rebuild only what is stale, so running this is cheap and repeatable.
  if (fs.existsSync(to) && fs.statSync(to).mtimeMs >= fs.statSync(from).mtimeMs) {
    skipped++;
    continue;
  }
  const info = await sharp(from)
    .resize({ width: WIDTH, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(to);
  written++;
  console.log(`  ${base.padEnd(34)} ${String(Math.round(info.size / 1024)).padStart(4)}KB`);
}

const total = fs.readdirSync(outDir).reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
console.log(
  `gallery-thumbs: ${written} written, ${skipped} already current — ` +
  `${seen.size} rail images, ${Math.round(total / 1024)}KB in total`,
);

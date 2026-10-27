#!/usr/bin/env node
/*
 * Every project in the catalogue must actually appear on the site.
 *
 * WHY THIS EXISTS. Riziki POS — a full point-of-sale system, live, one of the
 * larger things in here — was written up, linked and then invisible on the
 * homepage for weeks. The grid filtered on `p.media[0]`, so the one project
 * without screenshots was silently dropped. Nothing errored, nothing looked
 * broken, and the only way to notice was to count the tiles.
 *
 * A portfolio that quietly omits work is worse than one that lists it plainly,
 * so the omission is now a build failure rather than something to spot by eye.
 * Run with `npm run check:projects`; the build runs it too.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const portfolio = read("src/lib/portfolio.ts");

// Every project's slug, in catalogue order.
const slugs = [...portfolio.matchAll(/^\s{4}slug:\s*"([^"]+)"/gm)].map((m) => m[1]);
if (slugs.length === 0) {
  console.error("check-projects: found no projects in src/lib/portfolio.ts — has the shape changed?");
  process.exit(1);
}

const problems = [];

// 1. Each project needs a case-study route. The route is dynamic, so this is
//    really a check that nothing is excluded from generateStaticParams.
const exported = fs.existsSync(path.join(root, "out"))
  ? new Set(fs.readdirSync(path.join(root, "out/work"), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name))
  : null;
if (exported) {
  for (const slug of slugs) {
    if (!exported.has(slug)) problems.push(`${slug}: no page at out/work/${slug}/`);
  }
}

// 2. Nothing on the homepage may filter a project out for lacking an image.
//    This is the exact bug that hid Riziki: a truthy test on media inside the
//    list that decides which projects are shown at all.
const wall = read("src/components/visual-wall.tsx");
const filterLine = wall.match(/projects\.filter\(([^\n]*)\)/);
if (filterLine && /media\s*\[\s*0\s*\]/.test(filterLine[1])) {
  problems.push(
    "visual-wall.tsx: the mosaic filters on media[0], so any project without a " +
    "screenshot is dropped from the homepage. Draw the cover instead.",
  );
}

// 3. Flag — but do not fail on — projects with no screenshots. They are listed
//    now, and a cover is a fair stand-in, but it is worth knowing which ones
//    are carrying the weight on type alone.
const blocks = portfolio.split(/^\s{2}\{$/m);
const noMedia = [];
for (const slug of slugs) {
  const block = blocks.find((b) => b.includes(`slug: "${slug}"`));
  if (!block) continue;
  const media = block.match(/media:\s*\[([\s\S]*?)\]\s*,?\s*$/m);
  if (media && media[1].trim() === "") noMedia.push(slug);
}

console.log(`check-projects: ${slugs.length} projects in the catalogue`);
if (exported) console.log(`                ${slugs.length - problems.length} with an exported case study`);
if (noMedia.length) {
  console.log(`                no screenshots yet (listed with their cover): ${noMedia.join(", ")}`);
}

if (problems.length) {
  console.error("\ncheck-projects FAILED:");
  for (const p of problems) console.error("  · " + p);
  process.exit(1);
}
console.log("                ✓ every project is listed");

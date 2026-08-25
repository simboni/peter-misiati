/**
 * The staff handbook, served from inside the app.
 *
 * `src/content/handbook.html` is one self-contained document: its own styles,
 * its own script, and every screenshot inlined as a data URI. It is deliberately
 * NOT in `public/`. A file in `public/` is world-readable, and this document
 * carries pictures of the Formulas screens — the recipes are the business.
 * Serving it through a route handler means the session decides who sees what,
 * the same way every other screen in this app does.
 *
 * Two variants come out of the one source:
 *
 *   - `owner` — the document exactly as authored, every screen.
 *   - `staff` — the owner-only screens physically removed.
 *
 * "Physically removed" is the point. The document ships with an audience filter
 * an attendant could simply switch back to "Everything", so hiding by CSS would
 * put the formulas one tap away from the people the app spends its whole design
 * keeping them from. What is not in the bytes cannot be un-hidden, so the
 * filter's three chips are stripped from the staff copy too.
 *
 * Which screens are owner-only is not decided here. It is read off the document
 * itself (`data-aud="owner"`), and those tags mirror `MORE_GROUPS` and the
 * `ownerOnly` tabs in `src/components/nav.tsx`. If a screen changes hands, it
 * changes in both places — the test in `tests/handbook.test.ts` pins the list so
 * a silent drift shows up as a failure rather than as a leak.
 *
 * Both variants are built once and held in memory. The document is ~3 MB and
 * the shop's phones ask for it repeatedly; re-reading and re-cutting it per
 * request would be pure waste on a machine that is also running the till.
 *
 * ---------------------------------------------------------------------------
 * KNOWN GAP — the staff copy's screenshots are still the owner's screenshots.
 *
 * Cutting sections closes the section-level hole, not the picture-level one.
 * Every screenshot in the document was captured while signed in as the owner,
 * and six screens an attendant *can* reach render differently by role: sell,
 * sales, customers, day-close, stock and purchases. The clearest case is Stock —
 * `src/app/stock/page.tsx` deliberately strips the value-at-cost total and the
 * whole reagents list before they reach an attendant's phone, on the grounds
 * that reagent quantities give up the formula ratios by subtraction, and the
 * staff copy of this handbook currently shows both in a picture.
 *
 * Closing it means a second capture pass, signed in as the attendant, and a
 * document that carries both sets. That is a bigger change than this module,
 * and it is the owner's call whether the handbook waits for it. Until then the
 * staff copy should be treated as owner-visible material, and this is the note
 * that says so out loud rather than leaving it to be discovered.
 * ---------------------------------------------------------------------------
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type HandbookView = "owner" | "staff";

/** Same resolution as schema.sql: read from the source tree at runtime. */
const SOURCE = join(process.cwd(), "src", "content", "handbook.html");

let cache: Record<HandbookView, string> | null = null;

/** `<section id="x" data-aud="owner">` — the sections an attendant cannot reach. */
const OWNER_SECTION = /^<section id="([a-z]+)" data-aud="owner">$/;

/**
 * Cut the owner-only screens out of the document.
 *
 * The source is generated and rigidly formatted — one element per line in the
 * contents rail, and every `</section>` alone at the start of its line — so this
 * walks lines rather than reaching for a DOM parser the server does not have.
 * Sections never nest, which is what makes "the next `</section>` closes this
 * one" true; `assertShape` below refuses to run if that stops holding.
 */
function toStaffCopy(source: string): string {
  const lines = source.split("\n");
  const ownerIds = new Set<string>();
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const section = line.match(OWNER_SECTION);
    if (section) {
      ownerIds.add(section[1]);
      // Skip to just past the closing tag.
      while (i < lines.length && lines[i] !== "</section>") i++;
      continue;
    }

    out.push(line);
  }

  // The rail links to the sections that are now gone, and the group heading
  // that has nothing left under it.
  const railed = out.filter((line) => {
    const link = line.match(/^<a href="#([a-z]+)" data-id="[a-z]+">/);
    return !(link && ownerIds.has(link[1]));
  });

  return (
    dropEmptyRailGroups(railed)
      .join("\n")
      .replace(FILTER_CHIPS, "")
      // "Clear my ticks" was pushed to the far right to sit opposite the filter
      // chips. With those gone it would hang off the end of an empty bar, so let
      // it sit where the row starts.
      .replace('<button class="chip" id="reset" style="margin-left:auto"', '<button class="chip" id="reset"')
  );
}

/**
 * A group heading with no links under it reads as a screen that failed to load,
 * which is worse than no heading at all. ("Owner's view" holds only owner-only
 * screens, so it always empties out; the others may or may not.)
 */
function dropEmptyRailGroups(lines: string[]): string[] {
  return lines.filter((line, i) => {
    if (!line.startsWith('<div class="rail-group">')) return true;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].startsWith("<a href=\"#")) return true; // a link still follows
      if (lines[j].startsWith('<div class="rail-group">') || lines[j].includes("</nav>")) break;
    }
    return false;
  });
}

/**
 * The "Show: Everything / Attendant only / Owner only" chips. Pointless once
 * there is only one audience left in the file, and actively misleading — an
 * attendant pressing "Owner only" would be shown an empty page and conclude the
 * handbook was broken. The "Clear my ticks" button beside them is left alone.
 */
const FILTER_CHIPS =
  /\s*<span class="lbl">Show<\/span>\s*<button class="chip" data-f="all"[^>]*>[^<]*<\/button>\s*<button class="chip" data-f="staff"[^>]*>[^<]*<\/button>\s*<button class="chip" data-f="owner"[^>]*>[^<]*<\/button>/;

/**
 * Fail loudly at build-the-cache time rather than serving a mangled handbook.
 *
 * Every assumption this module makes about the document's shape is checked here
 * once. If someone regenerates the handbook in a different style, the shop gets
 * a 500 and the log says which assumption broke — far better than an attendant
 * quietly receiving a document with the recipes still in it.
 */
function assertShape(source: string): void {
  const opens = (source.match(/^<section id="[a-z]+" data-aud="(all|owner)">$/gm) ?? []).length;
  const closes = (source.match(/^<\/section>$/gm) ?? []).length;
  if (!opens || opens !== closes) {
    throw new Error(`handbook.html: ${opens} section openings but ${closes} closings — cannot split it safely`);
  }
  if (!FILTER_CHIPS.test(source)) {
    throw new Error("handbook.html: the audience filter chips are not where this module expects them");
  }
}

function build(): Record<HandbookView, string> {
  const owner = readFileSync(SOURCE, "utf8");
  assertShape(owner);

  const staff = toStaffCopy(owner);
  if (/data-aud="owner"/.test(staff)) {
    throw new Error("handbook.html: an owner-only section survived the staff cut");
  }

  return { owner, staff };
}

/** The document for this reader. Built on first use, then held. */
export function handbookFor(view: HandbookView): string {
  cache ??= build();
  return cache[view];
}

/** Which screens the document itself marks owner-only. Used by the tests. */
export function ownerOnlySections(): string[] {
  const source = readFileSync(SOURCE, "utf8");
  return [...source.matchAll(/^<section id="([a-z]+)" data-aud="owner">$/gm)].map((m) => m[1]);
}

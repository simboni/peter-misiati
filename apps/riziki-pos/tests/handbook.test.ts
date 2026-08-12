/**
 * The handbook's role split is a confidentiality boundary, not a display
 * preference: the staff copy is what stands between an attendant and pictures
 * of the formulas. So it is tested like one — the assertions below are about
 * bytes that must not be in the document, not about how it looks.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";

import { handbookFor, ownerOnlySections } from "../src/lib/handbook.ts";

const SOURCE = readFileSync(join(process.cwd(), "src", "content", "handbook.html"), "utf8");

/**
 * The screens the app itself keeps from attendants, from `MORE_GROUPS` and the
 * `ownerOnly` tabs in `src/components/nav.tsx`. Written out rather than derived
 * so that moving a screen between roles has to be a deliberate edit in both
 * places — the handbook is the one copy of this list that no route guard would
 * catch if it silently drifted.
 */
const OWNER_ONLY = [
  "formulas", // the recipes themselves
  "prices", // cost prices sit on this screen
  "reports", // profit
  "activity",
  "settings",
  "batch", // a batch run lists the formula's chemicals
  "repack", // raw-reagent quantities off the shelf
  "stocktake", // same
  "printer", // lives under Settings
];

test("the document's own tags match the app's owner-only screens", () => {
  assert.deepEqual(ownerOnlySections().sort(), [...OWNER_ONLY].sort());
});

test("the owner copy is the document, untouched", () => {
  assert.equal(handbookFor("owner"), SOURCE);
});

test("the staff copy has no owner-only screen left in it", () => {
  const staff = handbookFor("staff");
  for (const id of OWNER_ONLY) {
    assert.ok(!staff.includes(`<section id="${id}"`), `section #${id} survived`);
    assert.ok(!staff.includes(`href="#${id}"`), `contents link to #${id} survived`);
  }
  assert.ok(!staff.includes('data-aud="owner"'), "an owner-tagged element survived");
});

test("the staff copy keeps every screen an attendant can reach", () => {
  const staff = handbookFor("staff");
  for (const id of ["sell", "kit", "invoice", "sales", "debts", "dayclose", "expenses", "stock", "purchases", "pin", "offline"]) {
    assert.ok(staff.includes(`<section id="${id}"`), `section #${id} was cut by mistake`);
    assert.ok(staff.includes(`href="#${id}"`), `contents link to #${id} was cut by mistake`);
  }
});

test("the staff copy loses the audience filter, so nothing can switch it back", () => {
  const staff = handbookFor("staff");
  assert.ok(!staff.includes('data-f="owner"'), "the owner filter chip survived");
  assert.ok(!staff.includes('data-f="all"'), "the everything filter chip survived");
  assert.ok(staff.includes('id="reset"'), "the ticks reset button should stay");
  assert.ok(
    !staff.includes('id="reset" style="margin-left:auto"'),
    "the reset button is still pushed right, against chips that are no longer there",
  );
  // The owner copy keeps it opposite the chips, where it was designed to sit.
  assert.ok(handbookFor("owner").includes('id="reset" style="margin-left:auto"'));
});

test("the staff copy leaves no empty heading in the contents rail", () => {
  const lines = handbookFor("staff").split("\n");
  lines.forEach((line, i) => {
    if (!line.startsWith('<div class="rail-group">')) return;
    const next = lines.slice(i + 1).find((l) => l.startsWith('<a href="#') || l.startsWith('<div class="rail-group">') || l.includes("</nav>"));
    assert.ok(next?.startsWith('<a href="#'), `contents heading ${line} has nothing under it`);
  });
});

test("the staff copy is still a whole document, screenshots and all", () => {
  const staff = handbookFor("staff");
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

  assert.equal(count(staff, /^<section id="/gm), count(staff, /^<\/section>$/gm), "sections left unbalanced");
  assert.equal(count(staff, /^<section id="/gm), 24 - OWNER_ONLY.length);
  // Every screenshot that belongs to a surviving screen is still inlined, so
  // the copy works with no network behind it.
  assert.ok(count(staff, /src="data:image\/webp;base64,/g) > 20, "screenshots went missing");
  assert.ok(staff.trimEnd().endsWith("</script>"), "the document was truncated");
});

/**
 * Who can reach what in the menu.
 *
 * THE PRINTER IS THE REASON THIS FILE EXISTS. "The staff cannot reach the
 * receipt printer" was reported, fixed, and reported again — three times —
 * because the only way to check it was to sign in as an attendant and look,
 * and nothing in the suite would have noticed it being put back. The rule is
 * plain data now, so it can be held here instead of in somebody's memory.
 *
 * The menu is not the security boundary — every screen checks again on the
 * server before it reads anything — but a menu that hides a door an attendant
 * is allowed through is a fault of its own: it sends them to find the owner
 * to press a button they were always allowed to press.
 */

import test from "node:test";
import assert from "node:assert/strict";

const { MORE_GROUPS, allowed } = await import("../src/lib/menu.ts");

/** Every link in the menu, flattened, so nothing is checked by eye. */
const LINKS = MORE_GROUPS.flatMap((g) => g.links);
const byHref = (href: string) => LINKS.find((l) => l.href === href);

/** A plain attendant: no role, nothing granted by name. */
const attendant = (href: string) => allowed(byHref(href)?.need, false, []);
const withGrant = (href: string, keys: string[]) => allowed(byHref(href)?.need, false, keys);
const owner = (href: string) => allowed(byHref(href)?.need, true, []);

test("an attendant can reach the receipt printer", () => {
  assert.ok(byHref("/settings/printer"), "the printer is in the menu at all");
  assert.equal(
    byHref("/settings/printer")!.need,
    undefined,
    "it needs nothing: pairing a printer is counter work and stores nothing a staff member may not see",
  );
  assert.ok(attendant("/settings/printer"), "and so the person standing at the till can open it");
});

test("and so is changing their own PIN", () => {
  assert.ok(attendant("/pin"));
});

test("the owner's own tools stay the owner's", () => {
  for (const href of ["/settings", "/activity"]) {
    assert.equal(byHref(href)?.need, "owner", `${href} is owner-only`);
    assert.ok(!attendant(href), `${href} must not open for an attendant`);
    assert.ok(
      !withGrant(href, ["cost", "recipes", "products", "purchases", "stocktake", "void"]),
      `${href} cannot be granted by ticking boxes, however many are ticked`,
    );
    assert.ok(owner(href), "but the owner reaches it");
  }
});

test("a granted permission opens exactly its own door and no other", () => {
  // Cost prices and profit: the reports, the landed cost, the books check.
  assert.ok(!attendant("/landed"), "closed by default");
  assert.ok(withGrant("/landed", ["cost"]), "and open once granted");
  assert.ok(!withGrant("/landed", ["recipes"]), "a different grant is not this grant");

  assert.ok(withGrant("/formulas", ["recipes"]));
  assert.ok(withGrant("/items", ["products"]));
  assert.ok(!withGrant("/items", ["cost"]), "seeing cost prices is not permission to change prices");
});

test("an owner passes every check by being an owner", () => {
  for (const l of LINKS) {
    assert.ok(allowed(l.need, true, []), `${l.href} must open for an owner with nothing granted`);
  }
});

test("every link asks for something that exists, or for nothing", () => {
  /*
    A typo in a `need` is silent and one-way: the key matches no permission, so
    the link is invisible to every attendant for ever and only an owner would
    ever see the page. That is exactly how a door goes missing.
  */
  const KEYS = ["cost", "recipes", "products", "purchases", "stocktake", "void", "owner"];
  for (const l of LINKS) {
    if (l.need === undefined) continue;
    assert.ok(KEYS.includes(l.need), `${l.href} asks for "${l.need}", which is not a permission`);
  }
});

/**
 * The item colours.
 *
 * These are cosmetic, but two of their properties are not: every size of one
 * chemical must land on the same colour, or the grouping they exist to provide
 * is destroyed by the very thing it should group across; and the mapping must
 * be stable, because it is derived rather than stored and a change would
 * silently repaint the whole till after a deploy.
 */

import test from "node:test";
import assert from "node:assert/strict";

const { swatchFor, swatchKey, nameSize } = await import("../src/lib/swatch.ts");

test("every pack of one chemical shares its colour", () => {
  const sizes = ["H.C.L — 250 g", "H.C.L — 500 g", "H.C.L — 1 kg", "H.C.L — 20 kg"];
  const colours = new Set(sizes.map((n) => swatchFor(n).bar));
  assert.equal(colours.size, 1, "one chemical, one colour, whatever the pack");

  assert.notEqual(
    swatchFor("H.C.L — 1 kg").bar,
    swatchFor("Caustic Soda — 1 kg").bar,
    "different chemicals should not be forced onto the same colour",
  );
});

test("the key ignores the pack size and the case it was typed in", () => {
  assert.equal(swatchKey("Ungerol — 20 kg"), "ungerol");
  assert.equal(swatchKey("  UNGEROL  "), "ungerol");
  assert.equal(swatchKey("Optical Brightener — 1 kg"), "optical brightener");
});

test("the mapping is stable — a deploy must not repaint the shelf", () => {
  // Pinned deliberately. If a change to the hash or the palette moves these,
  // every attendant's muscle memory moves with it, so it should be a decision
  // rather than a side effect.
  const pinned: Array<[string, string]> = [
    ["Caustic Soda — 1 kg", "#486da1"],
    ["H.C.L — 1 kg", "#16708f"],
    ["Ungerol — 20 kg", "#4453a6"],
    ["Salt — 250 g", "#6b4a9e"],
  ];
  for (const [name, bar] of pinned) {
    assert.equal(swatchFor(name).bar, bar, `${name} changed colour`);
  }
});

test("short names are set large, long ones are not", () => {
  assert.match(nameSize("DOD — 1 kg"), /19px/, "a three-letter abbreviation is the whole tile");
  assert.match(nameSize("B.G — 1 L"), /19px/);
  assert.match(nameSize("Chlorine — 1 kg"), /15px/);
  assert.match(nameSize("Optical Brightener — 1 kg"), /13px/, "a long name needs the room instead");
});

test("every tint carries its own strong colour at 4.5:1, for the 11px size text", () => {
  // The size sits on the tint in the bar colour. Small text, so it needs the
  // full 4.5:1 — four of the first ten choices did not have it.
  const lum = (hex: string) => {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const f = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]);
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const names = ["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "g", "hh", "iii", "jjjj",
                 "kkkkk", "llllll", "m", "nn", "ooo", "pppp", "qqqqq", "rrrrrr", "s", "tt"];
  const seen = new Set<string>();
  for (const n of names) {
    const sw = swatchFor(n);
    seen.add(sw.bar);
    assert.ok(
      ratio(sw.tint, sw.bar) >= 4.5,
      `${sw.bar} on ${sw.tint} is only ${ratio(sw.tint, sw.bar).toFixed(2)}:1`,
    );
    // And the ink the name is set in must clear it comfortably too.
    assert.ok(ratio(sw.tint, "#0d2b30") >= 7, "the name must be easy on every tint");
  }
  assert.ok(seen.size >= 6, "the palette should actually spread, not collapse onto two hues");
});

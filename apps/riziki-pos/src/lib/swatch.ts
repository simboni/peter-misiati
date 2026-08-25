/**
 * Giving every item a face, without photographs.
 *
 * Most tills lean on product photos, and this shop has none. It is worth saying
 * that photographs would not help much even if it did: thirty-nine of the sixty
 * things on the shelf are abbreviations — B.G, C.D.E, C.M.A, C.M.C, DOD, EDTA,
 * H.C.L, I.P.A, NP9 — and a photograph of C.M.A powder is indistinguishable
 * from a photograph of C.M.C powder. Both are white powder in a white sack. The
 * picture would take a third of the tile and settle nothing.
 *
 * What actually tells them apart is the name, and the names are *short*. So the
 * name becomes the picture: set large when it is short enough to be set large,
 * on a tile tinted by a colour that belongs to that chemical. The colour is the
 * accelerator — every size of Chlorine is the same green, so the eye lands on
 * the group first and reads the size second — and the type carries the meaning,
 * which is the right way round when the meaning is four letters long.
 *
 * Two things this deliberately is not:
 *
 *   - it is not a hazard code. Colour here means "same chemical", nothing more.
 *     Encoding acid-versus-alkali would need somebody who knows the shelf to
 *     classify all sixty, and a wrong guess in a chemicals shop is not a
 *     cosmetic bug.
 *   - it is not unique. Ten hues over forty-odd chemicals collide by
 *     definition. It works the way a coloured folder tab works: it narrows the
 *     search, the label finishes it.
 *
 * The colour is derived from the name, so it is stable without a database
 * column: the same chemical is the same colour on every device, after any
 * restore, for ever, and nobody has to maintain it.
 *
 * NOTE for anyone adding a dark theme to this app later: these tints are fixed
 * light values carrying --color-ink text, and the till has no dark scheme
 * today. Introducing one that inverts --color-ink would leave near-white text
 * on a near-white tile. The public site had exactly that bug in its hero and it
 * shipped, because the contrast was only ever checked in light mode.
 */

export interface Swatch {
  /** Very pale — the tile background. Ink text clears 12:1 on all of these. */
  tint: string;
  /** Strong — the edge bar and the size text. */
  bar: string;
}

/*
  Ten hues, all at roughly the same lightness so no tile shouts louder than its
  neighbour, and all pale enough that the ink text on top is unaffected.

  The strong colour is not only the edge stripe — it also sets the pack size,
  which is 11px text and therefore needs 4.5:1 against the tint behind it. Four
  of the first ten choices came in between 3.6 and 4.3 and were darkened until
  they passed; every pair here now clears 4.7:1, checked rather than eyeballed.
*/
const PALETTE: Swatch[] = [
  { tint: "#eef2f9", bar: "#486da1" },
  { tint: "#e8f4f2", bar: "#2c766f" },
  { tint: "#eef5e8", bar: "#437729" },
  { tint: "#fbf2e3", bar: "#91610d" },
  { tint: "#fcedee", bar: "#a83f4c" },
  { tint: "#f2eef8", bar: "#6b4a9e" },
  { tint: "#e7f3f9", bar: "#16708f" },
  { tint: "#f4f7e5", bar: "#5c7412" },
  { tint: "#f7efe8", bar: "#8a5a34" },
  { tint: "#eceffa", bar: "#4453a6" },
];

/**
 * The part of a name that identifies the substance, without the pack size.
 *
 * "Ungerol — 20 kg" and "Ungerol — 1 kg" have to land on the same colour, or
 * the grouping the colour exists to provide is destroyed by the very thing it
 * should be grouping across.
 */
export function swatchKey(name: string): string {
  return name.split("—")[0].trim().toLowerCase();
}

export function swatchFor(name: string): Swatch {
  const key = swatchKey(name);
  // FNV-1a: short, stable across engines, and well spread for the tiny strings
  // it is given here. Nothing security-sensitive depends on it.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/**
 * How big to set the name.
 *
 * A four-letter abbreviation can be set at nearly twice the size of a
 * three-word product name in the same box, and should be: it is the whole
 * content of the tile, and it is what somebody is scanning for. Long names get
 * the smaller size not as a penalty but because they need the room.
 *
 * Returned as a class name rather than a number so the tile can stay a plain
 * server-rendered string with no inline font sizes to maintain.
 */
export function nameSize(name: string): string {
  const base = name.split("—")[0].trim();
  if (base.length <= 5) return "text-[19px] leading-[1.15] tracking-tight";
  if (base.length <= 9) return "text-[15px] leading-[1.2]";
  return "text-[13px] leading-tight";
}

/**
 * How big to set the price on a tile.
 *
 * Same reasoning as the name, for a harder constraint: the price may not wrap
 * and may not be truncated, because half a price is worse than no price. Three
 * tiles to a row on a 390 mm phone leaves about ninety pixels, which "KES 810"
 * fits and "KES 742.60/kg" does not — and what fell off the end was the "/kg",
 * turning a rate into what looks like the price of the whole drum.
 *
 * Measured on the money alone. The unit is set smaller by the tile and rides
 * along; a price short enough to keep its full size has room for it.
 */
export function priceSize(money: string): string {
  // Measured on a 390 px phone, three tiles to a row: the price gets 88 px.
  // "KES 810" fits at full size, "KES 1,215" needs a step down, and a price
  // with shillings and cents needs two. The price may not be truncated and may
  // not wrap, so the size is what gives.
  if (money.length <= 7) return "text-[17px]";
  if (money.length <= 9) return "text-[15px]";
  return "text-[13px]";
}

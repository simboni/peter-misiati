/**
 * Seed the database with Riziki Industrial Chemicals' real data.
 *
 * Sources:
 *   - the client's printed formulation sheets (Shower Gel, Shampoo, Laundry Soap,
 *     Jik Coloured, Handwash, Multipurpose, Harpic, Dettol, Jik, HPO, Fabric
 *     Softener, Degreaser) and the handwritten Carwash Shampoo page;
 *   - the "PARTICULARS / GT / OPENING STOCK / ADDED.S / T.T / CLOSING STOCK /
 *     SALES / REPACK" stock-take sheet, whose closing column becomes opening stock.
 *
 * Quantities marked TO CONFIRM are the gaps we found while transcribing; they are
 * carried into the formula note so the shop can settle them on screen.
 */

import { db, run, get, postMovement, audit } from "./db.ts";
import { hashPin } from "./pin.ts";
import { toMilli, toCents } from "./units.ts";

type Unit = "kg" | "L" | "pcs";

interface ChemSpec {
  key: string;
  name: string;
  unit: Unit;
  aliases?: string;
  perishable?: boolean;
  /** bulk container size in canonical units, e.g. 170 for a 170 kg drum */
  bulk?: number;
  bulkLabel?: string;
  /** repack sizes offered for resale */
  packs?: number[];
  /** cost per ONE bulk unit, KES */
  bulkCost?: number;
}

// ------------------------------------------------------------- chemicals

const CHEMICALS: ChemSpec[] = [
  { key: "ungerol", name: "Ungerol", unit: "kg", aliases: "sles,sodium lauryl ether sulfate,texapon",
    bulk: 170, bulkLabel: "drum", packs: [20, 5, 1, 0.5, 0.25], bulkCost: 64600 },
  { key: "ufacid", name: "Ufacid", unit: "kg", aliases: "labsa,sulphonic,sulphonic acid",
    bulk: 250, bulkLabel: "drum", packs: [20, 5, 4, 0.5, 0.25, 0.125], bulkCost: 87500 },
  { key: "salt", name: "Salt", unit: "kg", aliases: "industrial salt,sodium chloride",
    bulk: 50, bulkLabel: "bag", packs: [1, 0.5, 0.25], bulkCost: 3000 },
  { key: "finesalt", name: "Finesalt", unit: "kg", aliases: "fine salt",
    bulk: 50, bulkLabel: "bag", packs: [1], bulkCost: 4000 },
  { key: "hcl", name: "H.C.L", unit: "kg", aliases: "hydrochloric acid,hydrochloric",
    bulk: 40, bulkLabel: "drum", packs: [1, 0.5, 0.25], bulkCost: 7200 },
  { key: "hypo", name: "Hypo", unit: "L", aliases: "sodium hypochlorite,hpo,bleach concentrate",
    bulk: 23, bulkLabel: "drum", packs: [5, 1], bulkCost: 2760, perishable: true },
  { key: "chlorine", name: "Chlorine", unit: "kg", aliases: "calcium hypochlorite",
    bulk: 45, bulkLabel: "drum", packs: [20, 1], bulkCost: 13500, perishable: true },
  { key: "caustic", name: "Caustic Soda", unit: "kg", aliases: "sodium hydroxide,caustic,caustic pearls",
    bulk: 25, bulkLabel: "bag", packs: [1], bulkCost: 3750 },
  { key: "magadi", name: "Magadi", unit: "kg", aliases: "soda ash,sodium carbonate",
    bulk: 50, bulkLabel: "bag", packs: [1], bulkCost: 5000 },
  { key: "np9", name: "NP9", unit: "kg", aliases: "nonylphenol",
    bulk: 20, bulkLabel: "drum", packs: [5], bulkCost: 11000 },
  { key: "cde", name: "C.D.E", unit: "kg", aliases: "cdea,cocamide dea,foam booster",
    bulk: 20, bulkLabel: "drum", packs: [5], bulkCost: 10400 },
  // Confirmed by the owner: DOD is BAC 50 (benzalkonium chloride 50%), the
  // germicide in the disinfectant. "DOD gen" is the shop's short form.
  { key: "dod", name: "DOD", unit: "kg", aliases: "bac 50,benzalkonium chloride,dod gen,germicide",
    bulk: 20, bulkLabel: "drum", packs: [5, 1], bulkCost: 8000 },
  { key: "cmc", name: "C.M.C", unit: "kg", aliases: "carboxymethyl cellulose,thickener",
    bulk: 25, bulkLabel: "bag", packs: [1], bulkCost: 15000 },
  // For the thickened toilet-cleaner method — C.M.C would not survive the acid.
  // No cost on file yet; the weighted average arrives with the first purchase.
  { key: "acidthick", name: "Acid Thickener", unit: "kg", aliases: "acid thickner,thickener for acid",
    bulk: 25, bulkLabel: "bag", packs: [1] },
  { key: "stpp", name: "S.T.P.P", unit: "kg", aliases: "sodium tripolyphosphate",
    bulk: 25, bulkLabel: "bag", packs: [1], bulkCost: 10500 },
  { key: "simet", name: "Simet", unit: "kg", aliases: "simel,sodium metasilicate",
    bulk: 25, bulkLabel: "bag", packs: [1], bulkCost: 10000 },
  { key: "cbase", name: "Conditioner Base", unit: "kg", aliases: "c.base,c base,conditioner",
    bulk: 25, bulkLabel: "bag", packs: [1], bulkCost: 11250 },
  { key: "peroxide", name: "Peroxide", unit: "kg", aliases: "perocide,hydrogen peroxide",
    bulk: 30, bulkLabel: "drum", packs: [5], bulkCost: 7500, perishable: true },
  { key: "whiteoil", name: "White Oil", unit: "L", aliases: "white oll,mineral oil",
    bulk: 20, bulkLabel: "drum", packs: [5], bulkCost: 9000 },
  { key: "ipa", name: "I.P.A", unit: "L", aliases: "isopropyl alcohol,isopropanol",
    bulk: 20, bulkLabel: "drum", packs: [5], bulkCost: 12000 },
  { key: "blue", name: "Blue Colour", unit: "kg", aliases: "colour blue,acid blue",
    bulk: 1, bulkLabel: "tub", packs: [], bulkCost: 1800 },
  { key: "green", name: "Green Colour", unit: "kg", aliases: "colour green",
    bulk: 1, bulkLabel: "tub", packs: [], bulkCost: 1800 },
  { key: "brown", name: "Brown Colour", unit: "kg", aliases: "colour brown",
    bulk: 1, bulkLabel: "tub", packs: [], bulkCost: 1500 },
  { key: "colour", name: "Colour (assorted)", unit: "kg", aliases: "dye,cotour",
    bulk: 1, bulkLabel: "tub", packs: [], bulkCost: 1800 },
  // Formula-sheet chemicals not itemised on the stock sheet
  { key: "glycerine", name: "Glycerine", unit: "kg", aliases: "glycerin,glycerol",
    bulk: 25, bulkLabel: "drum", packs: [1], bulkCost: 8750 },
  { key: "pearlizer", name: "Pearlizer", unit: "kg", aliases: "peariizer,pearliser",
    bulk: 20, bulkLabel: "drum", packs: [1], bulkCost: 8000 },
  { key: "citric", name: "Citric Acid", unit: "kg", aliases: "citric",
    bulk: 25, bulkLabel: "bag", packs: [1], bulkCost: 11250 },
  { key: "edta", name: "EDTA", unit: "kg", aliases: "",
    bulk: 25, bulkLabel: "bag", packs: [1], bulkCost: 17500 },
  { key: "sodiumg", name: "Sodium G", unit: "kg", aliases: "sodium gluconate",
    bulk: 25, bulkLabel: "bag", packs: [1], bulkCost: 12500 },
  { key: "optical", name: "Optical Brightener", unit: "kg", aliases: "optical.b,optical b,brightener",
    bulk: 20, bulkLabel: "bag", packs: [1], bulkCost: 18000 },
  { key: "cma", name: "C.M.A", unit: "kg", aliases: "cma",
    bulk: 25, bulkLabel: "bag", packs: [1], bulkCost: 7500 },
  { key: "gbase", name: "G. Base", unit: "kg", aliases: "g base,softener base",
    bulk: 25, bulkLabel: "drum", packs: [1], bulkCost: 11250 },
  { key: "flares", name: "Flares", unit: "kg", aliases: "softener flares",
    bulk: 25, bulkLabel: "bag", packs: [1], bulkCost: 8750 },
  { key: "bg", name: "B.G", unit: "L", aliases: "b g,bg",
    bulk: 20, bulkLabel: "drum", packs: [1], bulkCost: 7000 },
  { key: "pineoil", name: "Pine Oil", unit: "pcs", aliases: "pine,pine/purple",
    bulk: 1, bulkLabel: "bottle", packs: [], bulkCost: 200 },
  { key: "perfume", name: "Perfume", unit: "pcs", aliases: "p.b,perfume bottle,fragrance",
    bulk: 1, bulkLabel: "bottle", packs: [], bulkCost: 150 },
];

// Closing stock from the client's stock-take sheet, in UNITS of each size.
// (bulk key is "bulk"; pack keys are the pack size as a string)
const OPENING: Record<string, Record<string, number>> = {
  ungerol: { bulk: 1, "20": 19, "5": 6, "1": 14, "0.5": 33, "0.25": 10 },
  ufacid: { bulk: 3, "20": 2, "5": 18, "0.5": 10, "0.25": 18, "0.125": 5 },
  salt: { bulk: 10, "1": 24, "0.5": 12, "0.25": 26 },
  finesalt: { bulk: 34, "1": 55 },
  hcl: { bulk: 5, "1": 11, "0.5": 8, "0.25": 5.5 },
  hypo: { bulk: 1, "5": 5, "1": 2 },
  chlorine: { bulk: 20, "20": 1, "1": 40 },
  caustic: { bulk: 5, "1": 19 },
  magadi: { bulk: 15, "1": 45 },
  finesalt_dup: {},
  np9: { bulk: 60, "5": 4 },
  cde: { bulk: 7, "5": 5 },
  dod: { bulk: 7, "5": 6, "1": 2 },
  cmc: { bulk: 3, "1": 42 },
  stpp: { bulk: 21, "1": 21 },
  simet: { bulk: 2, "1": 22 },
  cbase: { bulk: 1, "1": 29 },
  peroxide: { bulk: 5, "5": 6 },
  whiteoil: { bulk: 6, "5": 2 },
  ipa: { bulk: 2, "5": 6 },
  blue: { bulk: 34 },
  green: { bulk: 46 },
  brown: { bulk: 12 },
  colour: { bulk: 20 },
  glycerine: { bulk: 2, "1": 12 },
  pearlizer: { bulk: 2, "1": 8 },
  citric: { bulk: 1, "1": 10 },
  edta: { bulk: 1, "1": 6 },
  sodiumg: { bulk: 1, "1": 5 },
  optical: { bulk: 1, "1": 4 },
  cma: { bulk: 1, "1": 8 },
  gbase: { bulk: 2, "1": 10 },
  flares: { bulk: 2, "1": 12 },
  bg: { bulk: 2, "1": 6 },
  pineoil: { bulk: 10 },
  perfume: { bulk: 24 },
};

// ------------------------------------------------------------- formulas

interface FormulaSpec {
  name: string;
  refLitres: number;
  items: Array<[string, number]>; // [chemical key, qty in canonical unit]
  steps?: string;
  note?: string;
}

const FORMULAS: FormulaSpec[] = [
  {
    name: "Multipurpose",
    refLitres: 20,
    items: [["ungerol", 1], ["ufacid", 0.5], ["salt", 1], ["caustic", 0.02], ["cma", 0.02], ["colour", 0.02], ["perfume", 1]],
    steps: "Dissolve salt in warm water.\nAdd Ungerol and stir until dissolved.\nNeutralise Ufacid with caustic solution, then add.\nAdd C.M.A, colour and perfume.\nTop up to 20 L and rest until bubbles clear.",
  },
  {
    name: "Shower Gel",
    refLitres: 20,
    items: [["ungerol", 1.5], ["finesalt", 1], ["cde", 0.25], ["glycerine", 0.075], ["pearlizer", 0.06], ["citric", 0.05], ["ipa", 0.1], ["pineoil", 0.01], ["perfume", 0.5]],
    steps: "Dissolve Ungerol in warm water.\nBlend in C.D.E and glycerine.\nAdd pearlizer, then citric acid to adjust pH.\nAdd I.P.A, colour and perfume.\nThicken with finesalt solution and top up to 20 L.",
  },
  {
    name: "Shampoo",
    refLitres: 20,
    items: [["ungerol", 1], ["finesalt", 1], ["pearlizer", 0.1], ["glycerine", 0.1], ["cde", 0.1], ["colour", 0.02], ["perfume", 1]],
    note: "Confirmed with the owner: C.D.E is 100 g per 20 L. Perfume dose is 15 ml per 20 L — recorded as one bottle unit until perfume is stocked by volume.",
  },
  {
    name: "Handwash",
    refLitres: 5,
    items: [["ungerol", 0.5], ["finesalt", 0.25], ["glycerine", 0.02], ["pearlizer", 0.02], ["cde", 0.02], ["perfume", 0.5]],
  },
  {
    name: "Laundry Soap",
    refLitres: 20,
    items: [["ungerol", 1.5], ["salt", 1], ["cde", 0.125], ["edta", 0.1], ["sodiumg", 0.08], ["optical", 0.08], ["np9", 0.125], ["perfume", 1]],
    note: "Confirmed with the owner: ordinary Salt at 1 kg, not Finesalt. Perfume dose is 20 ml per 20 L — recorded as one bottle unit until perfume is stocked by volume.",
  },
  {
    name: "Carwash Shampoo",
    refLitres: 20,
    items: [["ungerol", 1], ["salt", 1], ["simet", 0.05], ["cde", 0.025]],
    note: "Handwritten page; caustic quantity is unreadable and colour/perfume are unquantified. Confirm with the owner.",
  },
  // Named "Toilet Cleaner" at the owner's request — Harpic is another
  // company's brand. Two confirmed methods for the same product.
  {
    name: "Toilet Cleaner",
    refLitres: 20,
    items: [["ungerol", 2], ["salt", 1], ["hcl", 2], ["blue", 0.015], ["perfume", 1]],
    note: "Confirmed with the owner. Acid blue is dosed as 15 ml per 20 L (about 15 g of the tub); perfume 15 ml — recorded as one bottle unit until perfume is stocked by volume.",
  },
  {
    name: "Toilet Cleaner (thickened)",
    refLitres: 20,
    items: [["acidthick", 0.4], ["hcl", 2], ["blue", 0.015]],
    note: "Second confirmed method: acid thickener replaces the Ungerol and salt. No perfume on this sheet.",
  },
  {
    name: "Dettol-type Disinfectant",
    refLitres: 20,
    items: [["np9", 0.5], ["dod", 0.5], ["pineoil", 4], ["brown", 0.02]],
  },
  {
    name: "Jik",
    refLitres: 20,
    items: [["chlorine", 0.5], ["caustic", 0.4], ["magadi", 1]],
    steps: "Dissolve magadi in cold water.\nAdd caustic solution and stir.\nAdd chlorine slowly. Bottle in opaque containers.",
  },
  {
    name: "Jik Coloured",
    refLitres: 20,
    items: [["peroxide", 0.5], ["np9", 0.1], ["blue", 0.005]],
    note: "Confirmed with the owner: per 20 L — hydrogen peroxide 1/2 kg, NP9 100 g, acid blue 5 ml. Sold as 5 L jerricans.",
  },
  {
    name: "HPO",
    refLitres: 5,
    items: [["hypo", 1]],
    note: "Sheet reads '1 LTS - 100 G MAKES 5 LTRS' — the second ingredient is unidentified. Confirm.",
  },
  {
    name: "Fabric Softener",
    refLitres: 20,
    items: [["gbase", 0.5], ["flares", 1], ["colour", 0.02], ["perfume", 1]],
    note: "The sheet says 'two types' of 20 L softener — capture the second variant with the owner.",
  },
  {
    name: "Degreaser",
    refLitres: 5,
    items: [["ufacid", 0.125], ["caustic", 0.1], ["magadi", 0.25], ["bg", 0.125], ["simet", 1.5]],
    note: "The handwritten 20 L version differs (adds S.T.P.P and Ungerol) — reconcile with the owner.",
  },
];

// Finished products bottled from the formulas above.
const FINISHED: Array<{ name: string; unit: Unit; size: number; label: string; retail: number; wholesale: number }> = [
  { name: "Multipurpose 1 L", unit: "L", size: 1, label: "bottle", retail: 100, wholesale: 80 },
  { name: "Multipurpose 5 L", unit: "L", size: 5, label: "jerrican", retail: 450, wholesale: 380 },
  { name: "Shower Gel 500 ml", unit: "L", size: 0.5, label: "bottle", retail: 250, wholesale: 200 },
  { name: "Shampoo 500 ml", unit: "L", size: 0.5, label: "bottle", retail: 200, wholesale: 160 },
  { name: "Handwash 500 ml", unit: "L", size: 0.5, label: "bottle", retail: 150, wholesale: 110 },
  { name: "Laundry Soap 1 L", unit: "L", size: 1, label: "bottle", retail: 120, wholesale: 90 },
  { name: "Laundry Soap 5 L", unit: "L", size: 5, label: "jerrican", retail: 500, wholesale: 420 },
  { name: "Toilet Cleaner 500 ml", unit: "L", size: 0.5, label: "bottle", retail: 180, wholesale: 140 },
  { name: "Dettol-type 500 ml", unit: "L", size: 0.5, label: "bottle", retail: 220, wholesale: 180 },
  { name: "Jik 1 L", unit: "L", size: 1, label: "bottle", retail: 130, wholesale: 100 },
  { name: "Fabric Softener 1 L", unit: "L", size: 1, label: "bottle", retail: 250, wholesale: 200 },
  { name: "Degreaser 1 L", unit: "L", size: 1, label: "bottle", retail: 200, wholesale: 160 },
  { name: "Carwash Shampoo 1 L", unit: "L", size: 1, label: "bottle", retail: 180, wholesale: 150 },
];

// Packaging is a real cost — a jerrican can be a fifth of a 5 L product's COGS.
const PACKAGING: Array<{ name: string; cost: number; qty: number }> = [
  { name: "500 ml bottle", cost: 15, qty: 400 },
  { name: "1 L bottle", cost: 25, qty: 350 },
  { name: "5 L jerrican", cost: 60, qty: 120 },
  { name: "20 L jerrican", cost: 180, qty: 40 },
  { name: "Bottle cap", cost: 3, qty: 900 },
  { name: "Product label", cost: 4, qty: 800 },
  { name: "Kit carrier bag", cost: 10, qty: 300 },
];

// ------------------------------------------------------------------ runner

export interface SeedOptions {
  /**
   * Post the opening stock counts from the client's stock sheet.
   *
   * Default true — a first boot at the shop wants the shelf as the paper says
   * it is. Set false to lay out the same catalogue with every count at zero,
   * which is what a training system needs: the shelves are all there and
   * correctly named, and the team learns by putting the first real numbers in
   * themselves. Opening stock cannot be removed after the fact — the ledger is
   * append-only by design — so it has to be skipped here or not at all.
   */
  openingStock?: boolean;
}

export function seed(
  options: SeedOptions = {},
): { chemicals: number; items: number; formulas: number } {
  const withOpeningStock = options.openingStock ?? true;

  db(); // ensure schema

  const already = get<{ n: number }>(`SELECT COUNT(*) AS n FROM chemicals`);
  if ((already?.n ?? 0) > 0) {
    return { chemicals: already!.n, items: 0, formulas: 0 };
  }

  // --- users -------------------------------------------------------------
  run(`INSERT INTO users (name, role, pin_hash) VALUES (?, ?, ?)`, "Owner", "owner", hashPin("1234"));
  run(`INSERT INTO users (name, role, pin_hash) VALUES (?, ?, ?)`, "Shop Attendant", "staff", hashPin("1111"));
  const ownerId = 1;

  // --- chemicals and their items ----------------------------------------
  const chemIds: Record<string, number> = {};
  const itemIds: Record<string, number> = {}; // `${key}:bulk` / `${key}:${size}`
  let itemCount = 0;

  for (const c of CHEMICALS) {
    const { lastInsertRowid: cid } = run(
      `INSERT INTO chemicals (name, canonical_unit, aliases, perishable) VALUES (?, ?, ?, ?)`,
      c.name,
      c.unit,
      c.aliases ?? "",
      c.perishable ? 1 : 0,
    );
    chemIds[c.key] = cid;

    const bulkSize = c.bulk ?? 1;
    const bulkCostCents = toCents(c.bulkCost ?? 0);
    const perUnitCents = bulkSize > 0 ? Math.round(bulkCostCents / bulkSize) : 0;

    // bulk row
    const bulkName = `${c.name} — ${bulkSize} ${c.unit} ${c.bulkLabel ?? "unit"}`;
    const { lastInsertRowid: bid } = run(
      `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                          sellable, retail_cents, wholesale_cents, floor_cents, cost_cents, reorder_level_milli)
       VALUES (?, ?, 'bulk', ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
      cid,
      bulkName,
      c.unit,
      toMilli(bulkSize),
      c.bulkLabel ?? "unit",
      bulkCostCents,
      toMilli(bulkSize * 2),
    );
    itemIds[`${c.key}:bulk`] = bid;
    itemCount++;

    // repack rows
    for (const size of c.packs ?? []) {
      const label = size >= 1 ? `${size} ${c.unit}` : `${size * 1000} ${c.unit === "kg" ? "g" : "ml"}`;
      const cost = Math.round(perUnitCents * size);
      const retail = Math.round((cost * 1.35) / 100) * 100; // ~35% markup, rounded to the shilling
      const wholesale = Math.round((cost * 1.2) / 100) * 100;
      const { lastInsertRowid: pid } = run(
        `INSERT INTO items (chemical_id, name, kind, canonical_unit, size_milli, unit_label,
                            sellable, retail_cents, wholesale_cents, floor_cents, cost_cents, reorder_level_milli)
         VALUES (?, ?, 'pack', ?, ?, 'pack', 1, ?, ?, ?, ?, ?)`,
        cid,
        `${c.name} — ${label}`,
        c.unit,
        toMilli(size),
        retail,
        wholesale,
        cost,
        cost,
        toMilli(size * 5),
      );
      itemIds[`${c.key}:${size}`] = pid;
      itemCount++;
    }
  }

  // --- finished goods ----------------------------------------------------
  for (const f of FINISHED) {
    const { lastInsertRowid: id } = run(
      `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label,
                          sellable, retail_cents, wholesale_cents, floor_cents, cost_cents, reorder_level_milli)
       VALUES (?, 'finished', ?, ?, ?, 1, ?, ?, ?, 0, ?)`,
      f.name,
      f.unit,
      toMilli(f.size),
      f.label,
      toCents(f.retail),
      toCents(f.wholesale),
      toCents(f.wholesale * 0.9),
      toMilli(f.size * 10),
    );
    itemIds[`finished:${f.name}`] = id;
    itemCount++;
  }

  // --- packaging ---------------------------------------------------------
  for (const p of PACKAGING) {
    const { lastInsertRowid: id } = run(
      `INSERT INTO items (name, kind, canonical_unit, size_milli, unit_label,
                          sellable, retail_cents, wholesale_cents, floor_cents, cost_cents, reorder_level_milli)
       VALUES (?, 'packaging', 'pcs', 1000, 'piece', 0, 0, 0, 0, ?, ?)`,
      p.name,
      toCents(p.cost),
      toMilli(50),
    );
    itemIds[`pack:${p.name}`] = id;
    itemCount++;
    if (withOpeningStock) {
      postMovement({ itemId: id, deltaMilli: toMilli(p.qty), reason: "opening", userId: ownerId, note: "opening count" });
    }
  }

  // --- what each finished product is packed into -------------------------
  // Bottling consumes these, and their cost lands in the product's cost, so a
  // 500 ml bottle is not reported as pure profit.
  const capId = itemIds["pack:Bottle cap"];
  const labelId = itemIds["pack:Product label"];
  for (const f of FINISHED) {
    const outId = itemIds[`finished:${f.name}`];
    if (!outId) continue;
    const container =
      f.size <= 0.5 ? "500 ml bottle" : f.size <= 1 ? "1 L bottle" : f.size <= 5 ? "5 L jerrican" : "20 L jerrican";
    const containerId = itemIds[`pack:${container}`];
    for (const [pid, qty] of [
      [containerId, 1],
      [capId, 1],
      [labelId, 1],
    ] as Array<[number | undefined, number]>) {
      if (!pid) continue;
      run(
        `INSERT OR IGNORE INTO item_packaging (item_id, packaging_item_id, qty_per_unit) VALUES (?, ?, ?)`,
        outId,
        pid,
        qty,
      );
    }
  }

  // --- opening stock from the stock-take sheet ---------------------------
  if (withOpeningStock) {
    for (const [key, sizes] of Object.entries(OPENING)) {
      for (const [sizeKey, units] of Object.entries(sizes)) {
        const itemId = itemIds[`${key}:${sizeKey}`];
        if (!itemId || units <= 0) continue;
        const item = get<{ size_milli: number }>(`SELECT size_milli FROM items WHERE id = ?`, itemId);
        if (!item) continue;
        postMovement({
          itemId,
          deltaMilli: Math.round(units * item.size_milli),
          reason: "opening",
          userId: ownerId,
          note: "closing stock carried from the stock-take sheet",
        });
      }
    }
  }

  // --- formulas ----------------------------------------------------------
  let formulaCount = 0;
  for (const f of FORMULAS) {
    const { lastInsertRowid: fid } = run(`INSERT INTO formulas (name) VALUES (?)`, f.name);
    const { lastInsertRowid: vid } = run(
      `INSERT INTO formula_versions (formula_id, version, ref_size_milli, steps, note, is_current, created_by)
       VALUES (?, 1, ?, ?, ?, 1, ?)`,
      fid,
      toMilli(f.refLitres),
      f.steps ?? "",
      f.note ?? "",
      ownerId,
    );
    let order = 0;
    for (const [key, qty] of f.items) {
      const cid = chemIds[key];
      if (!cid) throw new Error(`seed: formula "${f.name}" references unknown chemical "${key}"`);
      run(
        `INSERT INTO formula_items (formula_version_id, chemical_id, qty_milli, sort_order)
         VALUES (?, ?, ?, ?)`,
        vid,
        cid,
        toMilli(qty),
        order++,
      );
    }
    formulaCount++;
  }

  // --- suppliers and customers ------------------------------------------
  // Illustrative names, not the shop's real trading partners — so they go in
  // with the opening stock and stay out of a training system, where entering
  // the first supplier and the first debtor is part of what is being learned.
  if (withOpeningStock) {
    run(`INSERT INTO suppliers (name, phone, note) VALUES (?, ?, ?)`,
      "Nairobi Chemical Suppliers", "+254 720 000 001", "Ungerol, Ufacid, C.D.E");
    run(`INSERT INTO suppliers (name, phone, note) VALUES (?, ?, ?)`,
      "Magadi Soda Distributors", "+254 720 000 002", "Magadi, salt, caustic");

    run(`INSERT INTO customers (name, phone, kind, credit_limit_cents) VALUES (?, ?, 'wholesale', ?)`,
      "Mama Njeri Wholesalers", "+254 722 111 222", toCents(50000));
    run(`INSERT INTO customers (name, phone, kind, credit_limit_cents) VALUES (?, ?, 'wholesale', ?)`,
      "Kariobangi Hardware", "+254 733 444 555", toCents(30000));
    run(`INSERT INTO customers (name, phone, kind) VALUES (?, ?, 'retail')`, "Walk-in Customer", "");
  }

  audit(ownerId, "seed", "system", null, "database seeded with Riziki data");

  return { chemicals: CHEMICALS.length, items: itemCount, formulas: formulaCount };
}

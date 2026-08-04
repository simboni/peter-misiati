/**
 * The online product catalogue.
 *
 * Names are kept exactly as the shop and its customers say them — "Ungerol",
 * "Ufacid", "Magadi" — because that is what people type into a search box and
 * ask for over the counter. The textbook name goes in `aka` so the search box
 * finds the item either way.
 *
 * Nothing here is priced. Prices move with the exchange rate and the drum, so
 * every card sends the customer to WhatsApp or the phone instead.
 */

export type CategoryId =
  | "surfactants"
  | "alkalis-acids"
  | "builders-salts"
  | "additives"
  | "fragrance-colour"
  | "finished";

export type Category = {
  id: CategoryId;
  name: string;
  blurb: string;
};

export type CatalogueItem = {
  slug: string;
  /** The trading name, as printed on the shop's own list. */
  name: string;
  /** Chemical names, abbreviations and spellings customers also search for. */
  aka?: string[];
  category: CategoryId;
  /** What it is commonly used for, in a sentence a customer can act on. */
  uses: string;
  /** Pack sizes normally available. Bulk first, then repacks. */
  packs: string[];
  /**
   * Set when the description still needs the owner's word before it goes live.
   * Rendered as a visible "to be confirmed" note rather than a guess: a wrong
   * use for an industrial chemical is a safety problem, not a typo.
   */
  needsClientConfirmation?: boolean;
};

export const CATEGORIES: Category[] = [
  {
    id: "surfactants",
    name: "Surfactants",
    blurb: "The foaming and cleaning agents — the working part of any detergent.",
  },
  {
    id: "alkalis-acids",
    name: "Alkalis & Acids",
    blurb: "Strong actives: caustics, acids and bleaches. Handled and packed with care.",
  },
  {
    id: "builders-salts",
    name: "Builders & Salts",
    blurb: "Softeners, thickeners and fillers that make the actives work harder.",
  },
  {
    id: "additives",
    name: "Additives",
    blurb: "Small-dose ingredients that fix the look, feel and stability of a batch.",
  },
  {
    id: "fragrance-colour",
    name: "Fragrance & Colour",
    blurb: "What the customer smells and sees first.",
  },
  {
    id: "finished",
    name: "Finished Products",
    blurb: "Cleaners we mix ourselves, ready to use or to fill into your own packs.",
  },
];

/** Common repack ladder for liquids and pastes sold by weight. */
const REPACKS = ["20 kg", "5 kg", "1 kg", "500 g", "250 g"];
/** Small-dose powders go down one more step. */
const REPACKS_SMALL = ["20 kg", "5 kg", "1 kg", "500 g", "250 g", "125 g"];

export const ITEMS: CatalogueItem[] = [
  // ---------------------------------------------------------------- surfactants
  {
    slug: "sles-ungerol",
    name: "SLES / Ungerol 70%",
    aka: ["sodium lauryl ether sulphate", "sodium laureth sulfate", "texapon", "ungerol"],
    category: "surfactants",
    uses:
      "The main foaming and cleaning agent in shampoo, shower gel, handwash, dishwashing liquid and liquid laundry soap. Supplied as the 70% paste, which you dilute down.",
    packs: ["170 kg drum", ...REPACKS],
  },
  {
    slug: "labsa-ufacid",
    name: "LABSA (Ufacid)",
    aka: ["linear alkyl benzene sulphonic acid", "labsa 96", "ufacid", "sulphonic acid"],
    category: "surfactants",
    uses:
      "The detergent backbone of dishwashing liquid, laundry liquid and general cleaners. Neutralised with caustic soda before use — ask us for the ratio if you are new to it.",
    packs: ["250 kg drum", ...REPACKS],
  },
  {
    slug: "cde",
    name: "C.D.E",
    aka: ["coconut diethanolamide", "cocamide dea", "cde", "foam booster"],
    category: "surfactants",
    uses:
      "Foam booster and thickener. Holds the lather up in dishwash and shampoo and helps the batch thicken when salt is added.",
    packs: REPACKS,
  },
  {
    slug: "np9",
    name: "NP9",
    aka: ["nonylphenol ethoxylate", "np-9", "wetting agent", "non-ionic surfactant"],
    category: "surfactants",
    uses:
      "Non-ionic wetting agent used in degreasers, carwash shampoo and industrial floor cleaners, where oil and grease need lifting rather than foam.",
    packs: REPACKS,
  },
  {
    slug: "conditioner-base",
    name: "Conditioner Base",
    aka: ["conditioner", "softener base", "cationic base"],
    category: "surfactants",
    uses:
      "Ready-blended base for hair conditioner and fabric softener. You add water, perfume and colour to your own recipe.",
    packs: REPACKS,
  },

  // -------------------------------------------------------------- alkalis/acids
  {
    slug: "chlorine",
    name: "Chlorine",
    aka: ["hth", "calcium hypochlorite", "pool chlorine", "water treatment"],
    category: "alkalis-acids",
    uses:
      "Sanitising and water treatment — tanks, boreholes, pools and heavy-duty surface disinfection. Tell us the strength and form you need and we will pack it.",
    packs: ["Bulk", "5 kg", "1 kg", "500 g", "250 g"],
  },
  {
    slug: "hypo",
    name: "Hypo",
    aka: ["sodium hypochlorite", "bleach base", "jik base", "liquid bleach"],
    category: "alkalis-acids",
    uses:
      "Liquid bleach base. The active behind Jik-type bleach, whitening laundry and general disinfecting. Never mix it with acid or ammonia cleaners.",
    packs: ["Bulk", "20 kg", "5 kg", "1 kg", "500 g"],
  },
  {
    slug: "caustic-soda",
    name: "Caustic Soda",
    aka: ["sodium hydroxide", "naoh", "caustic flakes", "lye"],
    category: "alkalis-acids",
    uses:
      "Flake sodium hydroxide. Neutralises LABSA in liquid detergents, saponifies oils for bar and paste soap, and clears blocked drains. Strongly corrosive — add caustic to water, never water to caustic.",
    packs: ["25 kg bag", "5 kg", "1 kg", "500 g", "250 g"],
  },
  {
    slug: "caustic-pearls",
    name: "Caustic Pearls",
    aka: ["sodium hydroxide pearls", "caustic beads", "naoh pearls"],
    category: "alkalis-acids",
    uses:
      "The same sodium hydroxide in bead form. Pours and weighs cleanly with far less dust than flakes, which is why most small mixers prefer it.",
    packs: ["25 kg bag", "5 kg", "1 kg", "500 g", "250 g"],
  },
  {
    slug: "hydrochloric-acid",
    name: "Hydrochloric Acid",
    aka: ["hcl", "muriatic acid", "spirits of salt", "toilet cleaner acid"],
    category: "alkalis-acids",
    uses:
      "The active in Harpic-type toilet cleaners, and used for descaling, removing cement splash and cleaning tiles. Corrosive — supplied for trade use with handling advice.",
    packs: ["Bulk", "20 kg", "5 kg", "1 kg"],
  },
  {
    slug: "peroxide",
    name: "Peroxide",
    aka: ["hydrogen peroxide", "h2o2", "oxygen bleach"],
    category: "alkalis-acids",
    uses:
      "Oxygen bleach for stain removal, colour-safe whitening and sanitising where chlorine would be too harsh or leave a smell.",
    packs: ["Bulk", "20 kg", "5 kg", "1 kg", "500 g"],
  },

  // ------------------------------------------------------------ builders/salts
  {
    slug: "soda-ash",
    name: "Soda Ash (Magadi)",
    aka: ["sodium carbonate", "magadi", "washing soda", "soda ash light"],
    category: "builders-salts",
    uses:
      "Softens hard water so detergent is not wasted, raises pH and bulks out laundry powder. The workhorse builder in almost every washing recipe.",
    packs: ["50 kg bag", ...REPACKS],
  },
  {
    slug: "stpp",
    name: "S.T.P.P",
    aka: ["sodium tripolyphosphate", "stpp", "tripolyphosphate", "builder"],
    category: "builders-salts",
    uses:
      "Detergent builder. Locks up hardness in the wash water, lifts oily soil and stops loosened dirt settling back on the cloth.",
    packs: REPACKS_SMALL,
  },
  {
    slug: "finesalt",
    name: "Finesalt",
    aka: ["fine salt", "sodium chloride", "thickening salt"],
    category: "builders-salts",
    uses:
      "Fine-grade salt used to thicken shampoo, shower gel and dishwashing liquid. Add it slowly — past a point the batch thins again.",
    packs: ["50 kg bag", ...REPACKS],
  },
  {
    slug: "industrial-salt",
    name: "Industrial Salt",
    aka: ["coarse salt", "sodium chloride", "water softener salt"],
    category: "builders-salts",
    uses:
      "Coarse salt for water softeners, bulk cleaning and industrial process use where cosmetic fineness is not needed.",
    packs: ["50 kg bag", "20 kg", "5 kg", "1 kg"],
  },
  {
    slug: "cmc",
    name: "C.M.C",
    aka: ["carboxymethyl cellulose", "cmc", "thickener", "anti-redeposition"],
    category: "builders-salts",
    uses:
      "Thickener and anti-redeposition agent. Gives body to pastes and gels and keeps loosened dirt suspended in the water instead of back on the fabric.",
    packs: REPACKS_SMALL,
  },

  // ------------------------------------------------------------------ additives
  {
    slug: "edta",
    name: "EDTA",
    aka: ["ethylenediaminetetraacetic acid", "chelating agent", "sequestrant"],
    category: "additives",
    uses:
      "Chelating agent. Ties up the calcium, magnesium and iron in hard water so the surfactant can work and the product does not discolour on the shelf.",
    packs: REPACKS_SMALL,
  },
  {
    slug: "sodium-gluconate",
    name: "Sodium Gluconate",
    aka: ["gluconate", "sequestrant", "concrete cleaner", "chelating agent"],
    category: "additives",
    uses:
      "Sequestrant that keeps working at high pH, so it suits caustic cleaners, bottle-washing and cleaning off concrete and rust marks.",
    packs: REPACKS_SMALL,
  },
  {
    slug: "optical-brightener",
    name: "Optical Brightener",
    aka: ["oba", "fwa", "fluorescent whitening agent", "brightener", "whitening agent"],
    category: "additives",
    uses:
      "Makes washed whites look brighter by converting invisible UV into visible blue light. A small dose is enough — overdosing turns fabric grey-blue.",
    packs: REPACKS_SMALL,
  },
  {
    slug: "glycerine",
    name: "Glycerine",
    aka: ["glycerin", "glycerol", "humectant"],
    category: "additives",
    uses:
      "Humectant that holds moisture. Softens the feel of handwash, shower gel, shampoo and soap so they are kinder on the skin.",
    packs: REPACKS,
  },
  {
    slug: "pearlizer",
    name: "Pearlizer",
    aka: ["pearlising agent", "pearlizer", "pearliser", "opacifier"],
    category: "additives",
    uses:
      "Gives shampoo, shower gel and handwash the creamy pearl shine customers read as a quality product. Stirred in cold at the end of the batch.",
    packs: REPACKS,
  },
  {
    slug: "citric-acid",
    name: "Citric Acid",
    aka: ["citric", "ph adjuster", "descaler", "lemon acid"],
    category: "additives",
    uses:
      "Brings a batch down to the right pH, descales kettles and bathrooms, and sharpens the performance of rinse aids.",
    packs: REPACKS_SMALL,
  },
  {
    slug: "ipa",
    name: "I.P.A",
    aka: ["isopropyl alcohol", "isopropanol", "rubbing alcohol", "ipa"],
    category: "additives",
    uses:
      "Fast-drying solvent. The base of hand sanitiser and glass cleaner, and used to degrease surfaces and electronics without leaving a film.",
    packs: ["Bulk", "20 kg", "5 kg", "1 kg", "500 g"],
  },
  {
    slug: "white-oil",
    name: "White Oil",
    aka: ["mineral oil", "liquid paraffin", "paraffin oil"],
    category: "additives",
    uses:
      "Light mineral oil used in furniture and tyre polish, as a light lubricant and as a carrier in some cosmetic blends.",
    packs: REPACKS,
  },
  {
    slug: "dod",
    name: "DOD",
    aka: ["dod", "disinfectant concentrate"],
    category: "additives",
    uses:
      "Concentrate used in disinfectant recipes. Exact use and dilution to be confirmed by Riziki — please ask before you order.",
    packs: REPACKS,
    needsClientConfirmation: true,
  },
  {
    slug: "simet",
    name: "Simet",
    aka: ["simet"],
    category: "additives",
    uses:
      "Stocked as part of the cleaner-making range. Description and dilution to be confirmed by Riziki — please ask before you order.",
    packs: REPACKS,
    needsClientConfirmation: true,
  },
  {
    slug: "bg",
    name: "B.G",
    aka: ["butyl glycol", "butyl cellosolve", "2-butoxyethanol", "bg"],
    category: "additives",
    uses:
      "Solvent that cuts through grease and oily films. Used in degreasers, glass cleaners and heavy-duty workshop cleaners.",
    packs: REPACKS,
  },

  // ----------------------------------------------------------- fragrance/colour
  {
    slug: "pine-oil",
    name: "Pine Oil",
    aka: ["pine", "pine gel", "disinfectant scent", "floor cleaner"],
    category: "fragrance-colour",
    uses:
      "The scent and character of pine-type floor cleaners and disinfectant gels. Also used on its own for a clean, strong finish.",
    packs: ["Bulk", "20 kg", "5 kg", "1 kg", "500 g", "250 g"],
  },
  {
    slug: "perfumes-colours",
    name: "Perfumes and Colours",
    aka: ["fragrance", "perfume oil", "dye", "colourant", "scent"],
    category: "fragrance-colour",
    uses:
      "A range of fragrance oils and colours for shampoos, gels, softeners and cleaners. Scents in stock change — call or WhatsApp us for today's list.",
    packs: ["1 kg", "500 g", "250 g", "125 g"],
  },

  // ----------------------------------------------------------- finished goods
  {
    slug: "multipurpose-cleaner",
    name: "Multipurpose Cleaner",
    aka: ["all purpose cleaner", "general cleaner", "surface cleaner"],
    category: "finished",
    uses: "Everyday cleaner for floors, worktops, walls and painted surfaces.",
    packs: ["Bulk and small packs — call for sizes"],
  },
  {
    slug: "shower-gel",
    name: "Shower Gel",
    aka: ["body wash", "bath gel"],
    category: "finished",
    uses: "Body wash, mixed here. Tell us the scent you want when you order in bulk.",
    packs: ["Bulk and small packs — call for sizes"],
  },
  {
    slug: "shampoo",
    name: "Shampoo",
    aka: ["hair shampoo", "hair wash"],
    category: "finished",
    uses: "Hair shampoo for household use and for salons buying by the drum.",
    packs: ["Bulk and small packs — call for sizes"],
  },
  {
    slug: "handwash",
    name: "Handwash",
    aka: ["hand wash", "liquid soap", "hand soap"],
    category: "finished",
    uses: "Liquid hand soap for homes, offices, schools and washrooms.",
    packs: ["Bulk and small packs — call for sizes"],
  },
  {
    slug: "laundry-soap",
    name: "Laundry Soap",
    aka: ["washing soap", "liquid detergent", "clothes soap"],
    category: "finished",
    uses: "Laundry soap for hand washing and machines. Good for resale by the litre.",
    packs: ["Bulk and small packs — call for sizes"],
  },
  {
    slug: "carwash-shampoo",
    name: "Carwash Shampoo",
    aka: ["car shampoo", "vehicle wash", "car wash soap"],
    category: "finished",
    uses: "High-foam vehicle wash for carwash businesses and home use.",
    packs: ["Bulk and small packs — call for sizes"],
  },
  {
    slug: "toilet-cleaner",
    name: "Toilet Cleaner (Harpic-type)",
    aka: ["harpic", "toilet bowl cleaner", "wc cleaner", "thick bleach"],
    category: "finished",
    uses: "Thick acid cleaner for toilet bowls, urinals and limescale.",
    packs: ["Bulk and small packs — call for sizes"],
  },
  {
    slug: "disinfectant",
    name: "Disinfectant (Dettol-type)",
    aka: ["dettol", "antiseptic", "germicide", "sanitiser"],
    category: "finished",
    uses: "Antiseptic disinfectant for floors, surfaces and general household use.",
    packs: ["Bulk and small packs — call for sizes"],
  },
  {
    slug: "bleach",
    name: "Bleach (Jik-type)",
    aka: ["jik", "chlorine bleach", "whitener", "sodium hypochlorite"],
    category: "finished",
    uses: "Chlorine bleach for whitening laundry and disinfecting sinks, floors and drains.",
    packs: ["Bulk and small packs — call for sizes"],
  },
  {
    slug: "fabric-softener",
    name: "Fabric Softener",
    aka: ["softener", "comfort", "conditioner for clothes"],
    category: "finished",
    uses: "Rinse-cycle softener that leaves clothes soft and scented.",
    packs: ["Bulk and small packs — call for sizes"],
  },
  {
    slug: "degreaser",
    name: "Degreaser",
    aka: ["engine cleaner", "kitchen degreaser", "oil remover", "workshop cleaner"],
    category: "finished",
    uses: "Heavy-duty cleaner for kitchen extractors, engines, workshop floors and machinery.",
    packs: ["Bulk and small packs — call for sizes"],
  },
];

/** Shown on the home page as a taste of the catalogue — the ones most asked for. */
export const POPULAR_SLUGS = [
  "sles-ungerol",
  "caustic-soda",
  "labsa-ufacid",
  "soda-ash",
  "hypo",
  "cde",
  "stpp",
  "hydrochloric-acid",
];

export function itemsBySlug(slugs: string[]): CatalogueItem[] {
  return slugs
    .map((slug) => ITEMS.find((item) => item.slug === slug))
    .filter((item): item is CatalogueItem => item !== undefined);
}

export function categoryName(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.name ?? "";
}

/** Strip everything but letters and digits, so "s.t.p.p" and "stpp" agree. */
export function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * One lower-cased haystack per item, built once at module load.
 *
 * The whole catalogue ships to the browser and is filtered there — there is no
 * server to ask. Precomputing keeps typing smooth on a cheap phone.
 *
 * Each haystack holds the text twice: as written, and with punctuation removed.
 * Customers type "stpp" and "cde" far more often than "S.T.P.P" and "C.D.E",
 * and a catalogue that fails on the way people actually type is a dead page.
 */
export const SEARCH_INDEX: Record<string, string> = Object.fromEntries(
  ITEMS.map((item) => {
    const text = [
      item.name,
      ...(item.aka ?? []),
      item.uses,
      categoryName(item.category),
      ...item.packs,
    ].join(" ");
    return [item.slug, `${text.toLowerCase()} ${squash(text)}`];
  }),
);

/** True when every word the customer typed appears somewhere in the item. */
export function matchesQuery(slug: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = SEARCH_INDEX[slug] ?? "";
  return terms.every((term) => haystack.includes(term) || haystack.includes(squash(term)));
}

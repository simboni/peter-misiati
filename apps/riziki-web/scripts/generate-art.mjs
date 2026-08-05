/**
 * Brand illustration generator — run `npm run art` after changing anything.
 *
 * Draws the site's illustrations as SVG files into public/art/. SVG because:
 * copyright-clean (drawn, not scraped), a few KB each, razor sharp at every
 * screen size, and recolourable by editing the palette below.
 *
 * The style is taken from the shop itself, not a stock library: the yellow
 * drums with handwritten labels in the real shop photos are the most
 * recognisable thing Riziki owns, so the drum is the recurring character.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "art");
mkdirSync(OUT, { recursive: true });

// The site's own palette (globals.css) plus the drum yellow from the photos.
const P = {
  teal: "#0e7c86",
  tealDark: "#0a5f67",
  tealSoft: "#e2f0f1",
  leaf: "#5a9c2f",
  leafSoft: "#e9f3df",
  ink: "#14262b",
  muted: "#5d7278",
  drum: "#f0bf1a",
  drumDark: "#d9a70e",
  drumLight: "#f7d34c",
  cap: "#d23c2a",
  paper: "#ffffff",
  sack: "#ece0c8",
  sackDark: "#d9c9a6",
};

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-hidden="true">\n${body}\n</svg>\n`;

/** Scattered soap bubbles — outlined, a couple filled, never busy. */
function bubbles(spots) {
  return spots
    .map(([x, y, r, filled]) =>
      filled
        ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${P.leaf}" opacity="0.16"/>`
        : `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${P.teal}" stroke-width="2.5" opacity="0.28"/>`,
    )
    .join("\n");
}

/** The Riziki drum: yellow, ribbed, red cap, hand-labelled. */
function drum(x, y, w, h, label, sub) {
  const rib = (ry) =>
    `<rect x="${x + 6}" y="${ry}" width="${w - 12}" height="9" rx="4.5" fill="${P.drumDark}" opacity="0.55"/>`;
  return `
  <rect x="${x}" y="${y + 14}" width="${w}" height="${h - 14}" rx="14" fill="${P.drum}"/>
  <ellipse cx="${x + w / 2}" cy="${y + 16}" rx="${w / 2}" ry="15" fill="${P.drumLight}"/>
  <ellipse cx="${x + w / 2}" cy="${y + 16}" rx="${w / 2 - 7}" ry="10" fill="${P.drum}"/>
  <circle cx="${x + w / 2 + w * 0.22}" cy="${y + 14}" r="8" fill="${P.cap}"/>
  ${rib(y + h * 0.42)}
  ${rib(y + h * 0.72)}
  <rect x="${x + w * 0.16}" y="${y + h * 0.475}" width="${w * 0.68}" height="${h * 0.21}" rx="7" fill="${P.paper}"/>
  <text x="${x + w / 2}" y="${y + h * 0.575}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="800" font-size="${w * 0.13}" fill="${P.ink}">${label}</text>
  <text x="${x + w / 2}" y="${y + h * 0.65}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="600" font-size="${w * 0.095}" fill="${P.muted}">${sub}</text>
  <rect x="${x + 8}" y="${y + 26}" width="10" height="${h * 0.55}" rx="5" fill="#ffffff" opacity="0.28"/>`;
}

/** Teal jerrican with a carrying handle and leaf cap. */
function jerrican(x, y, w, h) {
  return `
  <rect x="${x}" y="${y + h * 0.18}" width="${w}" height="${h * 0.82}" rx="14" fill="${P.teal}"/>
  <path d="M ${x + w * 0.14} ${y + h * 0.2} v -${h * 0.1} a 10 10 0 0 1 10 -10 h ${w * 0.42} a 10 10 0 0 1 10 10 v ${h * 0.1}"
        fill="none" stroke="${P.tealDark}" stroke-width="13" stroke-linecap="round"/>
  <rect x="${x + w * 0.68}" y="${y}" width="${w * 0.24}" height="${h * 0.14}" rx="5" fill="${P.leaf}"/>
  <rect x="${x + w * 0.12}" y="${y + h * 0.42}" width="${w * 0.76}" height="${h * 0.3}" rx="8" fill="${P.paper}" opacity="0.92"/>
  <text x="${x + w / 2}" y="${y + h * 0.62}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="800" font-size="${w * 0.17}" fill="${P.teal}">20 L</text>
  <rect x="${x + 9}" y="${y + h * 0.26}" width="9" height="${h * 0.5}" rx="4.5" fill="#ffffff" opacity="0.22"/>`;
}

/** Trigger spray bottle: horizontal head with nozzle, grip, then the body. */
function spray(x, y, w, h) {
  return `
  <rect x="${x + w * 0.02}" y="${y + h * 0.03}" width="${w * 0.72}" height="${h * 0.12}" rx="7" fill="${P.leaf}"/>
  <rect x="${x - w * 0.06}" y="${y + h * 0.055}" width="${w * 0.12}" height="${h * 0.065}" rx="3" fill="${P.tealDark}"/>
  <path d="M ${x + w * 0.18} ${y + h * 0.15} l ${w * 0.09} ${h * 0.15} h ${w * 0.13} l -${w * 0.05} -${h * 0.15} z" fill="${P.leaf}" opacity="0.8"/>
  <rect x="${x + w * 0.42}" y="${y + h * 0.15}" width="${w * 0.22}" height="${h * 0.12}" fill="${P.leaf}" opacity="0.55"/>
  <path d="M ${x + w * 0.12} ${y + h * 0.3} q -${w * 0.12} ${h * 0.12} -${w * 0.1} ${h * 0.3} v ${h * 0.28} a 12 12 0 0 0 12 12 h ${w * 0.5} a 12 12 0 0 0 12 -12 v -${h * 0.28} q ${w * 0.02} -${h * 0.18} -${w * 0.1} -${h * 0.3} z" fill="${P.paper}" stroke="${P.tealSoft}" stroke-width="3"/>
  <rect x="${x + w * 0.1}" y="${y + h * 0.52}" width="${w * 0.62}" height="${h * 0.24}" rx="7" fill="${P.tealSoft}"/>
  <circle cx="${x + w * 0.41}" cy="${y + h * 0.64}" r="${w * 0.1}" fill="${P.teal}"/>`;
}

/** Sealed repack: white pouch with a teal band. */
function pack(x, y, w, h, label) {
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${P.paper}" stroke="${P.tealSoft}" stroke-width="3"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h * 0.2}" rx="9" fill="${P.sackDark}" opacity="0.5"/>
  <rect x="${x + w * 0.12}" y="${y + h * 0.38}" width="${w * 0.76}" height="${h * 0.34}" rx="6" fill="${P.tealSoft}"/>
  <text x="${x + w / 2}" y="${y + h * 0.62}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="800" font-size="${w * 0.24}" fill="${P.teal}">${label}</text>`;
}

/** Woven sack with a rolled top, like the salt bags in the shop. */
function sack(x, y, w, h, label) {
  return `
  <path d="M ${x + w * 0.06} ${y + h * 0.2} q -${w * 0.1} ${h * 0.5} 0 ${h * 0.68} a 14 14 0 0 0 13 10 h ${w * 0.62} a 14 14 0 0 0 13 -10 q ${w * 0.1} -${h * 0.18} 0 -${h * 0.68} z" fill="${P.sack}"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h * 0.22}" rx="10" fill="${P.sackDark}"/>
  <rect x="${x + w * 0.16}" y="${y + h * 0.42}" width="${w * 0.68}" height="${h * 0.3}" rx="7" fill="${P.paper}"/>
  <text x="${x + w / 2}" y="${y + h * 0.62}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="800" font-size="${w * 0.16}" fill="${P.ink}">${label}</text>`;
}

/** Counter scale, the ACS-30 from the photos, simplified. */
function scale(x, y, w, h) {
  return `
  <rect x="${x + w * 0.08}" y="${y}" width="${w * 0.84}" height="${h * 0.16}" rx="7" fill="${P.tealDark}"/>
  <rect x="${x + w * 0.3}" y="${y + h * 0.16}" width="${w * 0.4}" height="${h * 0.34}" fill="${P.teal}"/>
  <rect x="${x}" y="${y + h * 0.5}" width="${w}" height="${h * 0.5}" rx="12" fill="${P.teal}"/>
  <rect x="${x + w * 0.1}" y="${y + h * 0.62}" width="${w * 0.46}" height="${h * 0.22}" rx="6" fill="${P.ink}"/>
  <text x="${x + w * 0.33}" y="${y + h * 0.79}" text-anchor="middle" font-family="ui-monospace,monospace" font-weight="700" font-size="${w * 0.13}" fill="#7ef2c1">1.000</text>
  <circle cx="${x + w * 0.78}" cy="${y + h * 0.73}" r="${w * 0.07}" fill="${P.leaf}"/>`;
}

// ------------------------------------------------------------------- hero

writeFileSync(
  join(OUT, "hero.svg"),
  svg(
    640,
    520,
    `
  <ellipse cx="400" cy="270" rx="230" ry="220" fill="${P.tealSoft}"/>
  <ellipse cx="330" cy="482" rx="255" ry="24" fill="${P.teal}" opacity="0.08"/>
  ${bubbles([
    [95, 105, 16], [150, 62, 9], [420, 48, 13], [500, 96, 8, true],
    [590, 190, 11], [56, 210, 8, true], [605, 320, 7],
  ])}
  ${drum(120, 140, 185, 330, "UNGEROL", "170 kg")}
  ${jerrican(345, 235, 150, 235)}
  ${spray(520, 250, 95, 220)}
  ${pack(292, 396, 78, 76, "1 kg")}
  ${sack(30, 320, 105, 150, "SALT")}
`,
  ),
);

// -------------------------------------------------------------- card art

writeFileSync(
  join(OUT, "raw.svg"),
  svg(
    320,
    210,
    `
  <ellipse cx="160" cy="192" rx="130" ry="13" fill="${P.teal}" opacity="0.08"/>
  ${bubbles([[52, 40, 10], [280, 32, 7, true], [296, 92, 9]])}
  ${drum(72, 32, 100, 168, "UFACID", "250 kg")}
  ${sack(185, 96, 78, 104, "SALT")}
  ${pack(20, 128, 56, 70, "500g")}
`,
  ),
);

writeFileSync(
  join(OUT, "finished.svg"),
  svg(
    320,
    210,
    `
  <ellipse cx="160" cy="192" rx="130" ry="13" fill="${P.teal}" opacity="0.08"/>
  ${bubbles([[40, 52, 11], [288, 44, 8], [270, 110, 6, true]])}
  ${spray(78, 24, 76, 176)}
  <rect x="176" y="70" width="72" height="130" rx="12" fill="${P.paper}" stroke="${P.tealSoft}" stroke-width="3"/>
  <rect x="196" y="46" width="32" height="26" rx="5" fill="${P.teal}"/>
  <rect x="188" y="108" width="48" height="52" rx="7" fill="${P.leafSoft}"/>
  <text x="212" y="140" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="800" font-size="15" fill="${P.leaf}">1 L</text>
`,
  ),
);

writeFileSync(
  join(OUT, "kit.svg"),
  svg(
    320,
    210,
    `
  <ellipse cx="160" cy="192" rx="130" ry="13" fill="${P.teal}" opacity="0.08"/>
  ${bubbles([[288, 40, 9], [34, 70, 7, true]])}
  ${scale(58, 64, 150, 130)}
  ${pack(96, 22, 62, 62, "2 kg")}
  ${pack(228, 92, 58, 66, "250g")}
  ${pack(232, 30, 48, 54, "50g")}
`,
  ),
);

console.log(`Drew hero.svg, raw.svg, finished.svg, kit.svg into public/art/`);

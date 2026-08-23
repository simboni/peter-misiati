import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the shop's logo lives, and whether it is actually there yet.
 *
 * The mark is a file the client owns, not something this repository can invent:
 * the green ring, the flask, the splat and the two typefaces are their brand,
 * and a hand-drawn approximation of somebody's logo is worse than no logo at
 * all. So the site asks the filesystem at build time instead of assuming.
 *
 * Present  → the real mark is rendered everywhere the brand appears.
 * Absent   → the "RZ" tile stands in, exactly as before.
 *
 * Checked at build rather than in the browser on purpose. An `onError` fallback
 * would mean every visitor briefly sees a broken-image icon on the client's own
 * website before JavaScript rescues it, and this site is a static export that
 * must look right before it hydrates.
 *
 * To switch it on: drop the file at `public/brand/riziki-logo.png` (or .webp /
 * .svg — all three are looked for) and rebuild. Nothing else changes.
 */
const CANDIDATES = [
  "brand/riziki-logo.svg",
  "brand/riziki-logo.webp",
  "brand/riziki-logo.png",
] as const;

export function logoSrc(): string | null {
  for (const rel of CANDIDATES) {
    if (existsSync(join(process.cwd(), "public", rel))) return `/${rel}`;
  }
  return null;
}

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
function find(base: string): string | null {
  for (const ext of ["svg", "webp", "png"]) {
    const rel = `brand/${base}.${ext}`;
    if (existsSync(join(process.cwd(), "public", rel))) return `/${rel}`;
  }
  return null;
}

/** The full lockup — emblem, RIZIKI CHEMICALS, and the script line. */
export function logoSrc(): string | null {
  return find("riziki-logo");
}

/**
 * The emblem alone: the ring, the flask and the bubbles.
 *
 * Wherever the shop's name is already set in text — the site header, the till's
 * top bar — the full lockup would be about 90px wide and its own wordmark four
 * pixels tall, which is not a logo, it is a smudge. The emblem stays legible at
 * icon size and the name is read from the type beside it.
 */
export function markSrc(): string | null {
  return find("riziki-mark") ?? find("riziki-logo");
}

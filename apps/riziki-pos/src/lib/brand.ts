import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the shop's logo lives, and whether it is actually there yet.
 *
 * The mark belongs to the client — the green ring, the flask, the splat, the
 * two typefaces — and is not something this repository should invent. So the
 * app asks the filesystem rather than assuming, and falls back to the "RZ" tile
 * when the file has not been supplied.
 *
 * Checked on the server, not with an `onError` in the browser: the counter
 * often loads this app on a bad connection, and a broken-image icon at the top
 * of the shop's own till is not a good first impression of it.
 *
 * To switch it on: drop the file at `public/brand/riziki-logo.png` (or .webp /
 * .svg) and restart. Nothing else changes.
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

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

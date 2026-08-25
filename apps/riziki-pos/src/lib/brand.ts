import { existsSync, readFileSync } from "node:fs";
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

// --------------------------------------------------------------- for the PDF

export interface PrintLogo {
  /** The file's own bytes, embedded in the PDF untouched. */
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * The logo in the one form a PDF can take without a decoder.
 *
 * `pdf.ts` is a hand-rolled writer with no image library behind it, and it is
 * meant to stay that way. A PDF can carry a JPEG stream verbatim — `DCTDecode`
 * hands the compressed bytes to the reader's own decoder — so a JPEG needs no
 * decoding here at all, only its pixel dimensions read off the header. A PNG
 * would mean inflating it and undoing the per-scanline filters, which is a
 * decoder by any other name.
 *
 * So the printed logo is a separate file from the screen one: WebP for the
 * browser, JPEG for paper, both generated from the same artwork. The JPEG is
 * flattened onto white, since it has no alpha and the paper is white anyway.
 */
export function printLogo(): PrintLogo | null {
  const path = join(process.cwd(), "public", "brand", "riziki-logo-print.jpg");
  if (!existsSync(path)) return null;

  const bytes = readFileSync(path);
  const size = jpegSize(bytes);
  if (!size) return null;
  return { bytes, width: size.width, height: size.height };
}

/**
 * A JPEG's pixel dimensions, off its start-of-frame marker.
 *
 * A JPEG is a chain of segments: 0xFF, a marker byte, then a two-byte length
 * covering itself. Walking that chain to the SOF marker is the whole job — the
 * frame header carries height then width as big-endian 16-bit values, three
 * bytes in. Nothing else in the file has to be understood.
 *
 * Every SOF variant is accepted except the four that are not frame headers at
 * all: C4 (Huffman tables), C8 (a JPEG extension), CC (arithmetic coding
 * conditioning), and the standalone markers below C0.
 */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null; // not a JPEG

  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++; // fill byte or padding; step over it rather than give up
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // standalone, no length
      continue;
    }
    if (marker === 0xda) return null; // start of scan — no frame header found
    const length = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (b[i + 5] << 8) | b[i + 6],
        width: (b[i + 7] << 8) | b[i + 8],
      };
    }
    if (length < 2) return null; // malformed; refuse rather than loop forever
    i += 2 + length;
  }
  return null;
}

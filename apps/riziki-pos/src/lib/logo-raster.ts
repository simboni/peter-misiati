/**
 * The shop's logo, reduced to something a thermal head can burn.
 *
 * A thermal printer has one ink and no grey: every dot is on or off. The logo
 * is a green flask and a wordmark, and handing it over as-is gets nothing at
 * all — which is exactly what the shop was seeing, because until now this
 * module did not exist and no picture was ever sent.
 *
 * Two jobs, and they are separate on purpose:
 *
 *   `rasterise` is arithmetic — pixels in, dots out — and is unit-tested.
 *   `logoBitmap` is the part that needs a browser: fetching the file and
 *   drawing it into a canvas to get at its pixels.
 *
 * WHY A THRESHOLD AND NOT DITHERING. A dithered photograph looks better; a
 * dithered logo looks like a rained-on logo. The mark here is flat colour on
 * white, so what it wants is a hard cut: anything that is not nearly white
 * becomes a dot. The cut is adjustable because "nearly white" depends on the
 * logo, and the settings screen shows the result before any paper is used.
 */

import { DOTS_PER_LINE, type Bitmap, type PaperWidth } from "./escpos.ts";

/** Straight pixels, the shape `CanvasRenderingContext2D.getImageData` returns. */
export interface Pixels {
  width: number;
  height: number;
  /** RGBA, four bytes a pixel, row by row. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface RasteriseOptions {
  /**
   * Anything darker than this becomes a dot. 0–255, where 255 would blacken
   * the whole sheet and 0 would print nothing.
   */
  threshold?: number;
  /** Dots to leave blank at the top and bottom, so the mark is not crowded. */
  padDots?: number;
}

export const DEFAULT_THRESHOLD = 200;

/**
 * The most roll a logo may spend: about 2 cm at 203 dpi.
 *
 * Width alone is the wrong control. The shop's mark is square, so sizing it to
 * three-quarters of the head made it 276 dots tall — four centimetres of paper
 * before the first word of the receipt, on every sale, on a roll somebody buys.
 * A tall logo is therefore narrowed until it fits this, and a wide one is not
 * touched.
 */
export const MAX_LOGO_DOTS = 160;

/**
 * Pixels to printer dots, scaled to fit the head exactly.
 *
 * Nearest-neighbour sampling rather than an averaging resize: averaging turns
 * the edges of a flat logo into a grey fringe, and a grey fringe against a hard
 * threshold is a ragged edge. Sampling keeps the shape.
 *
 * Transparency counts as paper. A logo saved on a transparent background would
 * otherwise come out as a solid black rectangle, which is one whole receipt's
 * worth of ink and the commonest way this goes wrong.
 */
export function rasterise(
  pixels: Pixels,
  widthDots: number,
  { threshold = DEFAULT_THRESHOLD, padDots = 0 }: RasteriseOptions = {},
): Bitmap {
  const w = Math.max(1, Math.floor(widthDots));
  if (!pixels.width || !pixels.height) {
    return { width: w, height: 1, data: new Uint8Array(Math.ceil(w / 8)) };
  }

  const scale = pixels.width / w;
  const drawn = Math.max(1, Math.round(pixels.height / scale));
  const height = drawn + padDots * 2;
  const bytesPerRow = Math.ceil(w / 8);
  const out = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < drawn; y++) {
    const sy = Math.min(pixels.height - 1, Math.floor(y * scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(pixels.width - 1, Math.floor(x * scale));
      const at = (sy * pixels.width + sx) * 4;
      const alpha = pixels.data[at + 3];
      if (alpha < 128) continue; // see-through is paper

      // Rec. 601 luma: the eye's own weighting, and what every other tool
      // reaching for "how dark is this" uses.
      const luma =
        0.299 * pixels.data[at] + 0.587 * pixels.data[at + 1] + 0.114 * pixels.data[at + 2];
      if (luma > threshold) continue; // light enough to leave as paper

      const row = (y + padDots) * bytesPerRow;
      out[row + (x >> 3)] |= 0b1000_0000 >> (x & 7);
    }
  }

  return { width: w, height, data: out };
}

/** How many dots of the bitmap are actually burned — the settings preview's sanity check. */
export function dotsSet(bmp: Bitmap): number {
  let n = 0;
  for (const byte of bmp.data) {
    let b = byte;
    while (b) {
      n += b & 1;
      b >>= 1;
    }
  }
  return n;
}

// --------------------------------------------------------------- the browser

/**
 * Load the logo and reduce it, in a browser.
 *
 * Returns null rather than throwing on every failure there is — no canvas, the
 * file missing, the phone offline with nothing cached. A receipt without a logo
 * is a receipt; a till that will not print because a picture would not load is
 * a shop that cannot sell.
 *
 * The result is cached per (source, width, threshold): the conversion is a few
 * milliseconds, but it happens on the path between "take the money" and paper
 * coming out, and that path should carry nothing it can avoid.
 */
const cache = new Map<string, Bitmap | null>();

export async function logoBitmap(
  src: string,
  paper: PaperWidth = 58,
  opts: RasteriseOptions = {},
): Promise<Bitmap | null> {
  if (typeof document === "undefined") return null;

  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const key = `${src}|${paper}|${threshold}|${opts.padDots ?? 0}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  let bitmap: Bitmap | null = null;
  let widthDots = Math.round(DOTS_PER_LINE[paper] * 0.72);
  try {
    const image = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx && canvas.width && canvas.height) {
      // White underneath, so a logo saved with transparency reduces the way it
      // looks on paper rather than as a black slab.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      // Narrow a tall logo until it fits the height budget. See MAX_LOGO_DOTS.
      const aspect = canvas.height / canvas.width;
      if (widthDots * aspect > MAX_LOGO_DOTS) {
        widthDots = Math.max(64, Math.round(MAX_LOGO_DOTS / aspect));
      }
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      bitmap = rasterise(pixels, widthDots, { threshold, padDots: opts.padDots ?? 8 });
    }
  } catch {
    bitmap = null;
  }

  cache.set(key, bitmap);
  return bitmap;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${src}`));
    image.src = src;
  });
}

/** Forget what has been converted — the settings screen, after a change. */
export function forgetLogo(): void {
  cache.clear();
}

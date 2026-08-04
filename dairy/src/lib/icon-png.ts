/**
 * The PWA icons, drawn in code.
 *
 * `manifest.ts` has always pointed at /icon-192.png and /icon-512.png, and
 * neither file existed — so both 404'd and some Androids suppress the install
 * prompt entirely when a manifest icon is missing. The app that is meant to
 * live on the home screen could not get onto it.
 *
 * No image library and no binary blob checked into the repo that nobody can
 * edit: a PNG is a signature, three chunks and a CRC, and `node:zlib` is in the
 * standard library. Run it with:
 *
 *     npx tsx src/lib/icon-png.ts
 *
 * Nothing in the app imports this at runtime.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/* ---------------------------------------------------------------- */
/* PNG encoding                                                      */
/* ---------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, Buffer.from(data), tail]);
}

/** `rgb` is width × height × 3 bytes, top row first. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, no alpha
  // compression 0, filter 0, interlace 0 — all left at their only legal value.

  // Every scanline carries a leading filter byte. Filter 0 (none) keeps this
  // readable; deflate does the compressing.
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/* ---------------------------------------------------------------- */
/* The mark                                                          */
/* ---------------------------------------------------------------- */

const BRAND: [number, number, number] = [0x0e, 0x5a, 0x47];
const MILK: [number, number, number] = [0xff, 0xff, 0xff];

/**
 * A drop of milk on the farm's green, full bleed.
 *
 * Recognised at 48px on a crowded home screen is the whole brief — a detailed
 * cow would be a smudge.
 */
function coverage(nx: number, ny: number): number {
  // Circle at the bottom, cone above it. `ny` runs -1 at the top to 1 at the
  // bottom, matching the scanline order.
  const cy = 0.22;
  const r = 0.5;
  const tipY = -0.72;

  if (ny >= cy) {
    const dy = ny - cy;
    return dy * dy + nx * nx <= r * r ? 1 : 0;
  }

  // Where the cone meets the circle, and how wide the circle is there.
  const dy = cy - ny;
  const t = Math.max(0, 1 - dy / (cy - tipY));
  const halfWidth = r * Math.pow(t, 0.62);
  return Math.abs(nx) <= halfWidth ? 1 : 0;
}

/**
 * `scale` shrinks the drop without shrinking the green.
 *
 * A "maskable" icon is cropped by the phone to whatever shape that launcher
 * uses — a circle on one Android, a squircle on the next — and only the middle
 * 80% is guaranteed to survive. The full-size drop reaches past that, so the
 * maskable copy is drawn smaller rather than shipped bitten off.
 */
export function drawIcon(size: number, scale = 1): Uint8Array {
  const out = new Uint8Array(size * size * 3);
  // 3×3 supersampling: without it the curve of the drop is visibly stepped at
  // 192px, which on a home screen full of clean icons reads as "broken".
  const S = 3;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const nx = (((x + (sx + 0.5) / S) / size) * 2 - 1) / scale;
          const ny = (((y + (sy + 0.5) / S) / size) * 2 - 1) / scale;
          hits += coverage(nx, ny);
        }
      }
      const a = hits / (S * S);
      const i = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) {
        out[i + c] = Math.round(BRAND[c] * (1 - a) + MILK[c] * a);
      }
    }
  }
  return out;
}

export function iconPng(size: number, scale = 1): Buffer {
  return encodePng(size, size, drawIcon(size, scale));
}

/* ---------------------------------------------------------------- */

/**
 * Every file `manifest.ts` and `layout.tsx` name. If you add one there, add it
 * here — a manifest that points at a file which is not on disk is how this
 * started.
 */
export const ICONS: Array<{ size: number; file: string; scale?: number }> = [
  { size: 192, file: "icon-192.png" },
  { size: 512, file: "icon-512.png" },
  // Cropped by the launcher, so the drop is drawn inside the safe circle.
  { size: 512, file: "icon-maskable-512.png", scale: 0.55 },
  // iOS ignores the manifest and looks for this by name.
  { size: 180, file: "apple-touch-icon.png" },
];

export function writeIcons(dir = join(process.cwd(), "public")): string[] {
  return ICONS.map(({ size, file, scale }) => {
    const path = join(dir, file);
    writeFileSync(path, iconPng(size, scale ?? 1));
    return path;
  });
}

// Only when run directly — importing this module must never write files.
if (process.argv[1] && /icon-png\.[tj]s$/.test(process.argv[1])) {
  for (const path of writeIcons()) console.log(`wrote ${path}`);
}

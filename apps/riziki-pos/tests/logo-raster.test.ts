/**
 * Turning the shop's logo into printer dots.
 *
 * The arithmetic only — loading the file and drawing it needs a browser, and is
 * kept separate for exactly that reason. What is tested here is the part that
 * decides which dots get burned, which is the part that can silently produce a
 * black rectangle or a blank strip.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { rasterise, dotsSet, DEFAULT_THRESHOLD, type Pixels } from "../src/lib/logo-raster.ts";

/** An image built from a function, so a test can state what it looks like. */
function image(width: number, height: number, at: (x: number, y: number) => [number, number, number, number]): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = at(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width, height, data };
}

const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

test("black ink burns a dot, white paper does not", () => {
  const solid = rasterise(image(8, 1, () => BLACK), 8);
  assert.equal(solid.data[0], 0xff, "eight dots, all on");

  const blank = rasterise(image(8, 1, () => WHITE), 8);
  assert.equal(blank.data[0], 0x00, "and nothing burned on a white row");
});

test("the leftmost dot is the top bit", () => {
  // Getting this backwards mirrors the logo, which nobody notices until the
  // wordmark comes out of the printer reversed.
  const bmp = rasterise(image(8, 1, (x) => (x === 0 ? BLACK : WHITE)), 8);
  assert.equal(bmp.data[0], 0b1000_0000);
});

test("a transparent background is paper, not a black slab", () => {
  // The commonest way this goes wrong: a logo saved on transparency arrives as
  // RGBA 0,0,0,0 — black, by the numbers — and prints as a solid rectangle.
  const bmp = rasterise(image(16, 4, () => CLEAR), 16);
  assert.equal(dotsSet(bmp), 0);
});

test("the bitmap is exactly the size its own header claims", () => {
  // A mismatch here is what makes a printer spit out four feet of noise.
  const bmp = rasterise(image(40, 20, () => BLACK), 32);
  assert.equal(bmp.width, 32);
  assert.equal(bmp.data.length, Math.ceil(32 / 8) * bmp.height);
});

test("it scales to the head's width and keeps the shape's proportions", () => {
  const bmp = rasterise(image(200, 100, () => BLACK), 50);
  assert.equal(bmp.width, 50);
  assert.equal(bmp.height, 25, "half as tall as it is wide, as the original was");
});

test("padding is blank paper above and below", () => {
  const bmp = rasterise(image(8, 2, () => BLACK), 8, { padDots: 3 });
  assert.equal(bmp.height, 8);
  assert.equal(bmp.data[0], 0, "first padded row is blank");
  assert.equal(bmp.data[3], 0xff, "the image starts after the padding");
  assert.equal(bmp.data[7], 0, "and blank again underneath");
});

test("the threshold decides what counts as ink", () => {
  const grey = image(8, 1, () => [180, 180, 180, 255]);
  assert.equal(dotsSet(rasterise(grey, 8, { threshold: 100 })), 0, "too light to burn");
  assert.equal(dotsSet(rasterise(grey, 8, { threshold: 220 })), 8, "dark enough now");
  assert.ok(DEFAULT_THRESHOLD > 180, "and the default treats this grey as ink");
});

test("colour is weighed the way an eye weighs it", () => {
  // Pure green is much lighter to look at than pure blue, and a logo that is
  // green on white must not come out as a black block.
  // Green 0,200,0 weighs 117; blue 0,0,200 weighs 23. One cut, two answers.
  const green = rasterise(image(8, 1, () => [0, 200, 0, 255]), 8, { threshold: 60 });
  const blue = rasterise(image(8, 1, () => [0, 0, 200, 255]), 8, { threshold: 60 });
  assert.equal(dotsSet(green), 0, "a bright green reads as light");
  assert.equal(dotsSet(blue), 8, "and a deep blue as dark");
});

test("an empty image is one blank row, not a crash", () => {
  const bmp = rasterise({ width: 0, height: 0, data: new Uint8Array() }, 384);
  assert.equal(bmp.width, 384);
  assert.equal(bmp.height, 1);
  assert.equal(dotsSet(bmp), 0);
});

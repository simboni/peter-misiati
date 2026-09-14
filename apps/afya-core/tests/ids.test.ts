/**
 * Offline identifier minting.
 *
 * The collision test is the one that matters: it is the failure that would show
 * up days later as two patients sharing a file number.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { mintLocalId, isLocalId, mintingDevice, assertDeviceCode, IdError, mintToken } =
  await import("../src/lib/ids.ts");

test("a minted id carries the device that minted it", () => {
  const id = mintLocalId("TAB1");
  assert.match(id, /^TAB1-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  assert.equal(mintingDevice(id), "TAB1");
  assert.ok(isLocalId(id));
});

test("two offline devices never mint the same id", () => {
  const a = new Set(Array.from({ length: 2000 }, () => mintLocalId("TAB1")));
  const b = new Set(Array.from({ length: 2000 }, () => mintLocalId("TAB2")));
  for (const id of b) {
    assert.ok(!a.has(id), "ids minted on different devices must never collide");
  }
});

test("the alphabet excludes characters that are misread aloud", () => {
  const ids = Array.from({ length: 500 }, () => mintLocalId("TAB1").split("-")[1]).join("");
  for (const ch of ["I", "O", "0", "1"]) {
    assert.ok(!ids.includes(ch), `"${ch}" is misread when a number is read out or hand-copied`);
  }
});

test("a bad device code is refused at the point of registration", () => {
  for (const bad of ["", "t", "tab1", "TAB-1", "TOOLONGCODE"]) {
    assert.throws(() => assertDeviceCode(bad), IdError, `"${bad}" must be refused`);
  }
});

test("session tokens are long and unguessable", () => {
  const tokens = new Set(Array.from({ length: 1000 }, () => mintToken()));
  assert.equal(tokens.size, 1000, "no repeats");
  assert.ok([...tokens][0].length >= 40);
});

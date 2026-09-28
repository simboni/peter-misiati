/**
 * The delivery note on the counter printer, and the logo above it.
 *
 * The shop has a Bluetooth thermal printer and a driver waiting at the door.
 * Until now the delivery note could only go to A5 on the office printer, which
 * is in the wrong room, and the logo never printed on thermal paper at all
 * because nothing in this module could draw a picture.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  renderDeliveryNote,
  deliveryNoteText,
  deliveryNoteBytes,
  rasterCommand,
  blocksToBytes,
  receiptBytes,
  testReceipt,
  DOTS_PER_LINE,
  type DeliveryNote,
  type Bitmap,
} from "../src/lib/escpos.ts";

const NOTE: DeliveryNote = {
  header: ["Riziki Industrial Chemicals", "Nairobi", "0722 000 000"],
  reference: "DN INV-00002",
  dateTime: "19 Sept 2026, 19:43",
  deliverTo: "Eastleigh Cleaners Ltd",
  phone: "0722 418 330",
  saleRef: "INV-00002",
  servedBy: "Owner",
  lines: [
    { name: "20 L jerrican", qty: "1 pcs" },
    { name: "Acid Thickener", qty: "18.5 kg" },
    { name: "Multipurpose Cleaner", qty: "23.5 L" },
  ],
  footer: "Goods remain the property of Riziki Industrial Chemicals until paid for in full.",
};

// ------------------------------------------------------------ what it says

test("a delivery note says what was handed over, and never what it cost", () => {
  const text = deliveryNoteText(NOTE);

  assert.match(text, /DELIVERY NOTE/);
  assert.match(text, /DN INV-00002/);
  assert.match(text, /Eastleigh Cleaners Ltd/);
  for (const line of NOTE.lines) {
    assert.ok(text.includes(line.name), `${line.name} is on the note`);
    assert.ok(text.includes(line.qty), `${line.qty} is on the note`);
  }
  assert.ok(!/KES/.test(text), "no money reaches a delivery note");
});

test("the signature block is printed, because it is the reason the paper exists", () => {
  const text = deliveryNoteText(NOTE);
  assert.match(text, /Received in good order/);
  assert.match(text, /Name\s+\.{4,}/);
  assert.match(text, /Sign\s+\.{4,}/);
  assert.match(text, /Date\s+\.{4,}/);
});

test("nothing overruns the roll, on either width", () => {
  for (const paper of [58, 80] as const) {
    for (const block of renderDeliveryNote(NOTE, { paper })) {
      assert.ok(
        block.text.length <= (paper === 58 ? 32 : 48),
        `"${block.text}" is too wide for ${paper} mm paper`,
      );
    }
  }
});

test("a long product name keeps its quantity readable", () => {
  // Two columns is what 58 mm cannot do: the name eats the width and the
  // quantity — the number the person counting drums wants — gets squeezed out.
  const text = deliveryNoteText({
    ...NOTE,
    lines: [{ name: "Dettol-type Disinfectant Concentrate", qty: "1 (18.5 kg)" }],
  });
  assert.ok(text.includes("1 (18.5 kg)"), "the quantity survives in full");
});

test("one line is a line, two are lines", () => {
  assert.match(deliveryNoteText({ ...NOTE, lines: [NOTE.lines[0]] }), /1 line of goods/);
  assert.match(deliveryNoteText(NOTE), /3 lines of goods/);
});

// ------------------------------------------------------------- the picture

/** A tiny checkerboard: 16 dots across, 2 down, 2 bytes to a row. */
function checker(): Bitmap {
  return { width: 16, height: 2, data: Uint8Array.from([0b10101010, 0b01010101, 0xff, 0x00]) };
}

test("a picture is sent as GS v 0, with the width in bytes and the height in dots", () => {
  const cmd = rasterCommand(checker());
  assert.deepEqual(cmd.slice(0, 4), [0x1d, 0x76, 0x30, 0x00], "GS v 0, mode 0");
  assert.deepEqual(cmd.slice(4, 6), [2, 0], "two bytes per row, little-endian");
  assert.deepEqual(cmd.slice(6, 8), [2, 0], "two dots high, little-endian");
  assert.deepEqual([...cmd.slice(8)], [0b10101010, 0b01010101, 0xff, 0x00]);
});

test("a bitmap whose data does not match its own header is refused", () => {
  // Getting this wrong is what makes a printer spit out four feet of noise.
  assert.throws(
    () => rasterCommand({ width: 384, height: 10, data: new Uint8Array(4) }),
    /needs 480/,
  );
});

test("the logo prints before the text, centred, and puts the alignment back", () => {
  const bytes = [...blocksToBytes([{ text: "HELLO" }], { logo: checker() })];
  const centre = [0x1b, 0x61, 0x01];
  const left = [0x1b, 0x61, 0x00];
  const raster = bytes.indexOf(0x1d);

  const at = (needle: number[], from = 0) =>
    bytes.findIndex((_, i) => i >= from && needle.every((b, j) => bytes[i + j] === b));

  const centred = at(centre);
  assert.ok(centred >= 0 && centred < raster, "centred before the picture");
  assert.ok(at(left, raster) > raster, "and left again after it");
  assert.ok(bytes.indexOf(0x48) > raster, "the text follows the picture"); // 'H'
});

test("no logo means no picture command at all", () => {
  const bytes = [...blocksToBytes([{ text: "HELLO" }])];
  assert.equal(bytes.indexOf(0x1d), bytes.lastIndexOf(0x1d), "the only GS is the cut");
});

test("a receipt is still exactly what it was", () => {
  // The byte assembler was pulled out from under receipts so the delivery note
  // could use it too. Receipts must not have noticed.
  const bytes = receiptBytes(testReceipt(["Riziki"], "Asante sana"), { paper: 58 });
  assert.equal(bytes[0], 0x1b, "ESC");
  assert.equal(bytes[1], 0x40, "@ — init");
  assert.ok(bytes.length > 200, "and a whole receipt behind it");
});

test("the head is 384 dots on 58 mm paper and 576 on 80", () => {
  assert.equal(DOTS_PER_LINE[58], 384);
  assert.equal(DOTS_PER_LINE[80], 576);
});

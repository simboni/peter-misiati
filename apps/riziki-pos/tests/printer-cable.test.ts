/**
 * The printer on the end of a cable.
 *
 * Almost all of this code needs a browser and a printer in the room. These are
 * the two pieces that do not, and they are the two worth being sure of: which
 * endpoint a receipt is pushed down, and how a job is cut up on the way. Get
 * the endpoint wrong and the receipt vanishes with no error anywhere; get the
 * chunking wrong and the bottom of the receipt is missing.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { chunks } from "../src/lib/printer-channel.ts";
import {
  pickPrinterEndpoint,
  isBaud,
  BAUD_RATES,
  DEFAULT_BAUD,
  USB_PRINTER_CLASS,
  type UsbConfiguration,
} from "../src/lib/printer-cable.ts";

// ------------------------------------------------------- cutting up a job

test("a job is cut into pieces of the size asked for, in order", () => {
  const bytes = Uint8Array.from({ length: 10 }, (_, i) => i);
  const parts = chunks(bytes, 4);
  assert.deepEqual(parts.map((p) => [...p]), [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
});

test("nothing is lost and nothing is added", () => {
  const bytes = Uint8Array.from({ length: 4097 }, (_, i) => i % 251);
  const rejoined = Uint8Array.from(chunks(bytes, 180).flatMap((p) => [...p]));
  assert.deepEqual([...rejoined], [...bytes], "a receipt must arrive whole or not at all");
});

test("a job smaller than one piece is one piece", () => {
  assert.equal(chunks(Uint8Array.of(1, 2, 3), 4096).length, 1);
});

test("an empty job is no pieces at all, not one empty one", () => {
  // A printer handed a zero-length write on some firmware answers by feeding
  // paper, which is a blank slip out of a roll somebody pays for.
  assert.deepEqual(chunks(new Uint8Array(0), 180), []);
});

test("a nonsense size still makes progress instead of looping for ever", () => {
  assert.equal(chunks(Uint8Array.of(1, 2, 3), 0).length, 3);
});

// ------------------------------------------------------- which USB endpoint

/** The shape WebUSB hands back, cut down to what the picker looks at. */
function config(...interfaces: UsbConfiguration["interfaces"]): UsbConfiguration {
  return { interfaces };
}
const printerIface = (n: number) => ({
  interfaceNumber: n,
  alternate: {
    interfaceClass: USB_PRINTER_CLASS,
    endpoints: [
      { endpointNumber: 1, direction: "in" as const, type: "bulk" as const },
      { endpointNumber: 2, direction: "out" as const, type: "bulk" as const },
    ],
  },
});

test("the printer interface and the endpoint pointing out of the computer", () => {
  // Direction matters and is easy to get backwards: the IN endpoint is the one
  // the printer talks on, and a receipt written to it goes nowhere at all.
  assert.deepEqual(pickPrinterEndpoint(config(printerIface(0))), {
    interfaceNumber: 0,
    endpointNumber: 2,
  });
});

test("a printer interface is preferred over anything else on the device", () => {
  // These machines often carry a vendor interface for their own configuration
  // tool. Writing ESC/POS to that prints nothing and reports nothing.
  const vendor = {
    interfaceNumber: 0,
    alternate: {
      interfaceClass: 255,
      endpoints: [{ endpointNumber: 4, direction: "out" as const, type: "bulk" as const }],
    },
  };
  assert.deepEqual(pickPrinterEndpoint(config(vendor, printerIface(1))), {
    interfaceNumber: 1,
    endpointNumber: 2,
  });
});

test("a vendor-specific printer is still printed on", () => {
  // Plenty of these declare no printer class at all and print perfectly well,
  // so "no class 7" must not mean "give up".
  const vendor = {
    interfaceNumber: 3,
    alternate: {
      interfaceClass: 255,
      endpoints: [{ endpointNumber: 5, direction: "out" as const, type: "bulk" as const }],
    },
  };
  assert.deepEqual(pickPrinterEndpoint(config(vendor)), {
    interfaceNumber: 3,
    endpointNumber: 5,
  });
});

test("an interrupt endpoint is not mistaken for a way to print", () => {
  const keyboardish = {
    interfaceNumber: 0,
    alternate: {
      interfaceClass: 3,
      endpoints: [{ endpointNumber: 1, direction: "out" as const, type: "interrupt" as const }],
    },
  };
  assert.equal(pickPrinterEndpoint(config(keyboardish)), null);
});

test("nothing to print on says so rather than guessing", () => {
  assert.equal(pickPrinterEndpoint(null), null);
  assert.equal(pickPrinterEndpoint(undefined), null);
  assert.equal(pickPrinterEndpoint(config()), null);
});

// ------------------------------------------------------------- the speed

test("the speeds offered are the ones these printers ship at", () => {
  assert.equal(DEFAULT_BAUD, 9600, "the factory setting on nearly every one of them");
  assert.ok(BAUD_RATES.includes(115200));
});

test("a speed from storage is checked before it is used", () => {
  // It comes back off a phone as whatever JSON.parse made of it.
  assert.ok(isBaud(9600));
  assert.ok(isBaud("19200"), "a number that arrived as text is still that number");
  assert.equal(isBaud(1234), false);
  assert.equal(isBaud(undefined), false);
  assert.equal(isBaud(null), false);
  assert.equal(isBaud("fast"), false);
});

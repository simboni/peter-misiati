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
  explainCable,
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

// -------------------------------------------------- saying which fault it is

/** The shape a browser throws: a DOMException is an Error with a `name`. */
function refusal(name: string, message = ""): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** Stand in for the browser, since node has no window. */
function withSecureContext<T>(secure: boolean | null, run: () => T): T {
  const had = "window" in globalThis;
  const before = (globalThis as { window?: unknown }).window;
  if (secure === null) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = { isSecureContext: secure };
  try {
    return run();
  } finally {
    if (had) (globalThis as { window?: unknown }).window = before;
    else delete (globalThis as { window?: unknown }).window;
  }
}

test("a blocked permission is not reported as a missing certificate", () => {
  /*
    The whole reason this split exists. The cable buttons are only drawn when
    the page is already secure, so the old single answer — "open the app over
    https" — could only ever be read by somebody for whom it was untrue. The
    shop went looking at its certificate while a Block sat in the browser's own
    site settings.
  */
  const said = withSecureContext(true, () => explainCable(refusal("SecurityError"), "serial"));
  assert.match(said, /blocked/i, "it says the site is blocked");
  assert.match(said, /address bar/i, "and where to go to undo it");
  assert.doesNotMatch(said, /https/i, "and never sends them to the certificate");
});

test("a USB route that is refused is not blamed on a permission", () => {
  /*
    The client's desktop, with Chrome's own site panel open beside it: USB
    devices "Ask (default)", Serial ports "Ask (default)", the printer listed
    by name with a Reset permission button next to it. Nothing was blocked.
    There was nothing on that screen to unblock, and an answer that said to go
    and unblock something sent somebody hunting for a setting that did not
    exist. What had refused was underneath the browser.
  */
  const said = withSecureContext(true, () => explainCable(refusal("SecurityError"), "usb"));
  assert.match(said, /operating system/i, "it names what actually has the printer");
  assert.match(said, /Connect by cable/, "and sends them to the route that works");
  assert.doesNotMatch(said, /set it back to Ask/i, "and never to a setting that is already right");
  assert.doesNotMatch(said, /https/i, "and never to the certificate");
});

test("a page opened over plain http still gets told so", () => {
  const said = withSecureContext(false, () => explainCable(refusal("SecurityError")));
  assert.match(said, /https/, "the old answer, for the case it was written for");
  assert.match(said, /localhost/, "with the way out on the machine itself");
});

test("off a browser altogether it does not guess", () => {
  // Rendered on the server, or read in a test: no window to ask.
  const said = withSecureContext(null, () => explainCable(refusal("SecurityError")));
  assert.match(said, /https/, "falls back to the safe, general answer");
});

test("a printer claimed by the operating system is named as that, not as a block", () => {
  const said = explainCable(refusal("NetworkError", "Failed to open serial port."));
  assert.match(said, /Windows and Linux/);
  assert.match(said, /COM port/, "and points at the route that works");
});

test("a chooser nobody picked from is not an error worth alarming about", () => {
  const said = explainCable(refusal("NotFoundError", "No port selected by the user."));
  assert.match(said, /No printer was chosen/);
});

/**
 * Seed from the command line. The app also seeds itself the first time the
 * login page loads, so this exists for setting up a database ahead of first
 * boot (e.g. on a new server, before handing the phone over).
 */

import { seed } from "../src/lib/seed.ts";

seed();
console.log("Seeded. Sign in as Owner (PIN 1234) and change the PINs before the shop opens.");

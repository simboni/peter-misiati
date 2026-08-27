/**
 * The state `deploy/start-fresh.sh` leaves behind, and what the app does to it.
 *
 * That script hands the shop a database with its user accounts and its settings
 * and nothing else — no chemicals, no products, no recipes — so the owner can
 * type the real catalogue in from the actual shelves. The login screen calls
 * `seed()` on every render, and this is the test that it leaves that alone.
 *
 * It has its own database file because `db.ts` reads `RIZIKI_DB` once at module
 * load: a virgin file is the only way to build the never-seeded state the script
 * produces, and `seed.test.ts` has already used its own for the opposite case.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "riziki-seed-emptied-"));
process.env.RIZIKI_DB = join(TMP, "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, run } = await import("../src/lib/db.ts");

process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const count = (t: string) => get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0;

test("a shop that cleared its shelves on purpose keeps them clear", () => {
  // What start-fresh.sh writes: the accounts carried across, and nothing else.
  run(
    `INSERT INTO users (name, role, pin_hash, active) VALUES (?, 'owner', ?, 1)`,
    "Peter",
    "not-the-shipped-pin",
  );
  assert.equal(count("chemicals"), 0, "the shelves start empty");

  // Signing in — which is what actually calls this.
  seed();

  /*
    Before this was fixed, `seed()` asked whether there were any chemicals.
    There were none, so it wrote all thirty-six back, plus fourteen recipes,
    plus a second Owner and a second Shop Attendant on the PINs the system
    shipped with — a security hole on top of a mess. An empty catalogue is a
    decision. An empty user table is a new machine.
  */
  assert.equal(count("chemicals"), 0, "the catalogue the shop cleared stays cleared");
  assert.equal(count("items"), 0);
  assert.equal(count("formulas"), 0);
  assert.equal(count("stock_movements"), 0, "and no opening stock it never counted");
  assert.equal(count("users"), 1, "no extra accounts on the shipped PINs");
  assert.equal(
    get<{ name: string }>(`SELECT name FROM users`)?.name,
    "Peter",
    "the owner's own account is the one that survived",
  );
});

test("and it stays clear however many times somebody signs in", () => {
  seed();
  seed();
  assert.equal(count("chemicals"), 0);
  assert.equal(count("users"), 1);
});

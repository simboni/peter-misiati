/**
 * When the shop's system is allowed to seed itself, and when it must not.
 *
 * The login screen calls `seed()` on every render, so this is not a
 * once-at-install question — it is asked several times a day, for as long as
 * the shop exists. Getting it wrong is silent and expensive: a shop that
 * cleared the delivered catalogue to type its own signs in, and finds the whole
 * thing back.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "riziki-seed-"));
process.env.RIZIKI_DB = join(TMP, "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { get, run } = await import("../src/lib/db.ts");

process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

const count = (t: string) => get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0;

test("a brand new machine gets the delivered catalogue and its two accounts", () => {
  const first = seed();
  assert.ok(first.chemicals > 0, "chemicals were written");
  assert.ok(first.formulas > 0, "recipes were written");
  assert.equal(count("users"), 2, "an owner and an attendant");
});

test("seeding twice does nothing the second time", () => {
  const users = count("users");
  const chemicals = count("chemicals");
  seed();
  assert.equal(count("users"), users, "no duplicate accounts");
  assert.equal(count("chemicals"), chemicals, "no duplicate catalogue");
});

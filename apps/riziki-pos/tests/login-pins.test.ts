/**
 * The starting PINs, and when the sign-in page may say them out loud.
 *
 * That line used to be printed unconditionally, so a live shop's sign-in page
 * published the two PINs the system ships with to anybody who loaded it — one
 * of which reads cost prices, margins and the recipes. It earns its place on
 * the first morning, when nobody has been told a PIN yet; it is worth nothing
 * and costs a great deal every morning after.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "riziki-login-pins-")), "test.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { usersOnDemoPin, changePin } = await import("../src/lib/users.ts");

seed();

test("a brand new machine is still on the shipped PINs, and says so", () => {
  const on = usersOnDemoPin();
  assert.equal(on.length, 2, "the owner and the attendant the system ships with");
  assert.deepEqual(on.map((u) => u.role).sort(), ["owner", "staff"]);
});

test("one account changed is not enough — the other still opens the door", () => {
  const owner = usersOnDemoPin().find((u) => u.role === "owner")!;
  changePin({ userId: owner.id, newPin: "4820", currentPin: "1234", byUserId: owner.id });
  const left = usersOnDemoPin();
  assert.equal(left.length, 1);
  assert.equal(left[0].role, "staff", "the attendant is still on 1111");
});

test("once every account has its own PIN, the hint has nothing to say", () => {
  // The owner resets the attendant's, which is how it actually happens.
  const owner = 1;
  for (const u of usersOnDemoPin()) changePin({ userId: u.id, newPin: "6154", byUserId: owner });
  assert.equal(usersOnDemoPin().length, 0);
});

test("and a shop that picks another obvious PIN is not counted as shipped", () => {
  /*
    "Still on the PIN it came with" is a different question from "picked a bad
    PIN". The first is answered here and stops the hint; the second is the
    weak-PIN warning's job, and conflating them would print 1234 on the sign-in
    page of a shop that had chosen 0000.
  */
  const anyone = usersOnDemoPin();
  assert.equal(anyone.length, 0, "nothing on this shop opens with a shipped PIN any more");
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.RIZIKI_DB = join(mkdtempSync(join(tmpdir(), "users-")), "t.db");

import test from "node:test";
import assert from "node:assert/strict";

const { seed } = await import("../src/lib/seed.ts");
const { all, get, run } = await import("../src/lib/db.ts");
const { verifyPin, hashPin } = await import("../src/lib/pin.ts");
const U = await import("../src/lib/users.ts");
const { listUsers, setPermissions, createUser, UserError } = U;
const { can, grantedTo, PERMISSIONS } = await import("../src/lib/permissions.ts");

seed();
const OWNER = 1;
const STAFF = 2;

test("adding someone stores a hash, never the PIN itself", () => {
  const id = U.createUser({ name: "Grace", pin: "8471", role: "staff", byUserId: OWNER });
  const row = get<{ pin_hash: string }>(`SELECT pin_hash FROM users WHERE id = ?`, id)!;

  assert.ok(!row.pin_hash.includes("8471"), "the PIN must not appear in the stored hash");
  assert.ok(verifyPin("8471", row.pin_hash), "the new PIN opens the account");
  assert.ok(!verifyPin("8472", row.pin_hash), "a wrong PIN does not");

  const logged = all<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'user_created' AND entity_id = ?`,
    id,
  );
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].detail.includes("8471"), "the PIN must not reach the audit log");
});

test("the last owner cannot be switched off or demoted", () => {
  assert.throws(
    () => U.setActive({ userId: OWNER, active: false, byUserId: OWNER }),
    /own account/,
    "you cannot switch yourself off",
  );

  // Even from another owner's session, the last remaining owner is protected.
  const second = U.createUser({ name: "Second Owner", pin: "9182", role: "owner", byUserId: OWNER });
  U.setActive({ userId: OWNER, active: false, byUserId: second });
  assert.throws(
    () => U.setActive({ userId: second, active: false, byUserId: OWNER }),
    /only owner/i,
    "the last active owner is protected",
  );
  assert.throws(
    () => U.setRole({ userId: second, role: "staff", byUserId: OWNER }),
    /only owner/i,
    "and cannot be demoted either",
  );

  U.setActive({ userId: OWNER, active: true, byUserId: second });
  U.setActive({ userId: second, active: false, byUserId: OWNER });
});

test("switching someone off signs them out of the counter phone at once", () => {
  run(`INSERT INTO sessions (token, user_id, expires_at) VALUES ('tok-staff', ?, '2099-01-01')`, STAFF);
  assert.equal(all(`SELECT 1 FROM sessions WHERE user_id = ?`, STAFF).length, 1);

  U.setActive({ userId: STAFF, active: false, byUserId: OWNER });

  assert.equal(
    all(`SELECT 1 FROM sessions WHERE user_id = ?`, STAFF).length,
    0,
    "a switched-off attendant must not stay signed in until their session expires",
  );
  U.setActive({ userId: STAFF, active: true, byUserId: OWNER });
});

test("a weak or wrong-length PIN is refused", () => {
  for (const bad of ["123", "12345", "abcd", "1234", "0000", "7777"]) {
    assert.throws(() => U.checkPin(bad), /4 digits|too easy/, `"${bad}" should be refused`);
  }
  assert.doesNotThrow(() => U.checkPin("5063"));
});

test("changing your own PIN needs the current one", () => {
  assert.throws(
    () => U.changePin({ userId: OWNER, newPin: "5063", byUserId: OWNER }),
    /current PIN/,
  );
  assert.throws(
    () => U.changePin({ userId: OWNER, newPin: "5063", currentPin: "9999", byUserId: OWNER }),
    /current PIN/,
  );

  U.changePin({ userId: OWNER, newPin: "5063", currentPin: "1234", byUserId: OWNER });
  const row = get<{ pin_hash: string }>(`SELECT pin_hash FROM users WHERE id = ?`, OWNER)!;
  assert.ok(verifyPin("5063", row.pin_hash));

  // An owner resetting someone else's PIN does not need to know it.
  U.changePin({ userId: STAFF, newPin: "6274", byUserId: OWNER });
  assert.ok(verifyPin("6274", get<{ pin_hash: string }>(`SELECT pin_hash FROM users WHERE id = ?`, STAFF)!.pin_hash));
});

test("two active people cannot share a name", () => {
  assert.throws(
    () => U.createUser({ name: "grace", pin: "5291", role: "staff", byUserId: OWNER }),
    /already uses the system/,
    "a duplicate name makes the sign-in list and the audit trail ambiguous",
  );
});

test("the starting-PIN warning fires, then clears once changed", () => {
  // Owner and staff were both changed above, so nothing should be flagged now.
  assert.equal(U.usersOnDemoPin().length, 0, "no account is on a shipped PIN any more");

  // A shipped PIN cannot be set through changePin — the weak-PIN guard refuses
  // it — so plant the hash directly to prove the warning still spots one.
  const temp = U.createUser({ name: "Temp", pin: "5291", role: "staff", byUserId: OWNER });
  run(`UPDATE users SET pin_hash = ? WHERE id = ?`, hashPin("1111"), temp);
  assert.ok(
    U.usersOnDemoPin().some((u) => u.id === temp),
    "an account back on a shipped PIN is flagged",
  );

  U.changePin({ userId: temp, newPin: "8390", byUserId: OWNER });
  assert.ok(!U.usersOnDemoPin().some((u) => u.id === temp), "and clears once changed");
});

test("shop settings round-trip, including the cash float", () => {
  U.setSetting("cash_float_cents", "500000", OWNER);
  assert.equal(U.getSetting("cash_float_cents"), "500000");
  U.setSetting("shop_kra_pin", "P051234567X", OWNER);
  assert.equal(U.getSetting("shop_kra_pin"), "P051234567X");
  assert.equal(U.getSetting("nothing_here", "fallback"), "fallback");
});

// ---------------------------------------------- what one person may see

test("an attendant sees nothing extra until an owner says so, by name", () => {
  const id = createUser({ name: "Grace Manager", pin: "8264", role: "staff", byUserId: OWNER });
  const her = () => listUsers().find((u) => u.id === id)!;

  assert.equal(her().permissions, "", "nothing is granted to start with");
  assert.equal(can({ role: "staff", permissions: "" }, "purchases"), false);

  setPermissions({ userId: id, permissions: ["purchases", "stocktake"], byUserId: OWNER });

  const after = her();
  assert.deepEqual(grantedTo(after).sort(), ["purchases", "stocktake"]);
  assert.equal(can(after, "purchases"), true, "what was granted");
  assert.equal(can(after, "cost"), false, "and nothing else — cost is not on the list");

  // The form posts what is ticked, so what arrives IS the answer: a permission
  // un-ticked has to disappear rather than linger.
  setPermissions({ userId: id, permissions: ["stocktake"], byUserId: OWNER });
  assert.deepEqual(grantedTo(her()), ["stocktake"], "the one taken away is gone");

  // Rubbish a form could send is ignored rather than stored.
  setPermissions({ userId: id, permissions: ["stocktake", "everything", ""], byUserId: OWNER });
  assert.deepEqual(grantedTo(her()), ["stocktake"], "only the six keys mean anything");
});

test("an owner already sees everything, and cannot be limited", () => {
  const owner = { role: "owner" as const, permissions: "" };
  for (const p of PERMISSIONS) {
    assert.equal(can(owner, p.key), true, `${p.key} comes with being the owner`);
  }

  const id = createUser({ name: "Second Owner", pin: "9173", role: "owner", byUserId: OWNER });
  assert.throws(
    () => setPermissions({ userId: id, permissions: ["cost"], byUserId: OWNER }),
    (e: Error) => e instanceof UserError && /already sees everything/.test(e.message),
    "ticking boxes on an owner would suggest they could be un-ticked",
  );
});

test("the permission change is written to the log with a name against it", () => {
  const id = createUser({ name: "Logged Person", pin: "6482", role: "staff", byUserId: OWNER });
  setPermissions({ userId: id, permissions: ["void"], byUserId: OWNER });

  const row = get<{ action: string; detail: string }>(
    `SELECT action, detail FROM audit_log WHERE entity = 'user' AND entity_id = ? ORDER BY id DESC LIMIT 1`,
    id,
  );
  assert.equal(row?.action, "permissions_set");
  assert.match(row!.detail, /Logged Person: void/);
});

/**
 * M02 Audit — the hash chain.
 *
 * These tests are the evidence behind the word "immutable". If they pass, an
 * inspector can be shown that history has not been edited; if the chain design
 * ever regresses, the compliance claim quietly becomes false.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-audit-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const { audit, verifyAuditChain, run, get, all, AuditError } = await import("../src/lib/db.ts");

test("an untouched log verifies", () => {
  audit({ action: "test_one", entity: "thing", entityId: 1 });
  audit({ action: "test_two", entity: "thing", entityId: 2 });
  audit({ action: "test_three", entity: "thing", entityId: 3 });

  const result = verifyAuditChain();
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.checked, 3);
});

test("each row links to the one before it", () => {
  const rows = all<{ id: number; prev_hash: string; hash: string }>(
    `SELECT id, prev_hash, hash FROM audit_log ORDER BY id`,
  );
  assert.equal(rows[0].prev_hash, "", "the first row opens the chain");
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i].prev_hash, rows[i - 1].hash, `row ${rows[i].id} must link to its predecessor`);
  }
});

test("editing a logged entry is detected", () => {
  const target = get<{ id: number }>(`SELECT id FROM audit_log WHERE action = 'test_two'`)!;
  run(`UPDATE audit_log SET action = 'test_two_tampered' WHERE id = ?`, target.id);

  const result = verifyAuditChain();
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "content-altered");
  assert.equal(!result.ok && result.failedAtId, target.id, "it names the row that was altered");

  run(`UPDATE audit_log SET action = 'test_two' WHERE id = ?`, target.id);
  assert.equal(verifyAuditChain().ok, true, "restoring the value restores the chain");
});

test("deleting a logged entry is detected", () => {
  const target = get<{ id: number }>(`SELECT id FROM audit_log WHERE action = 'test_two'`)!;
  run(`DELETE FROM audit_log WHERE id = ?`, target.id);

  const result = verifyAuditChain();
  assert.equal(result.ok, false, "a hole in the log must not verify");
  assert.equal(!result.ok && result.failedAtId, target.id + 1, "the successor is where the break shows");
});

test("a secret can never be written to the audit log", () => {
  for (const key of ["password", "pin", "token", "mfa_secret", "otp"]) {
    assert.throws(
      () => audit({ action: "leak", entity: "user", detail: { [key]: "hunter2" } }),
      AuditError,
      `"${key}" must be refused — the audit log is exported to people who should not see credentials`,
    );
  }
});

test("a read of a patient record is auditable, with a purpose", () => {
  audit({
    action: "patient_read",
    entity: "patient",
    entityId: "TAB1-7K4QMX",
    patientId: "TAB1-7K4QMX",
    purpose: "treatment",
    actorName: "Dr. Wanjiru",
  });
  const row = get<{ patient_id: string; purpose: string }>(
    `SELECT patient_id, purpose FROM audit_log ORDER BY id DESC LIMIT 1`,
  )!;
  assert.equal(row.patient_id, "TAB1-7K4QMX");
  assert.equal(row.purpose, "treatment", "every disclosure records why it happened");
});

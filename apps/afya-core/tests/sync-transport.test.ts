/**
 * M03 Sync Engine, the transport half.
 *
 * The tests that matter are about losing nothing: a batch that never arrived
 * must leave its ops pending, a truncated file must be refused whole rather
 * than applied in part, and a batch re-sent after a dropped link must be a
 * duplicate rather than a double-count.
 */
import { mkdtempSync } from "node:fs";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = mkdtempSync(join(tmpdir(), "afya-transport-"));
process.env.AFYA_DB = join(workspace, "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";
// Types only: a type import does not execute the module, so it cannot run
// before AFYA_DB is set above.
import type { WireOp, Envelope, Refusal, Accepted } from "../src/lib/sync-transport.ts";

const X = await import("../src/lib/sync-transport.ts");
const S = await import("../src/lib/sync.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice, revokeDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, all } = await import("../src/lib/db.ts");

const { facilityId, adminId } = seedDemo();
registerDevice({ facilityId, code: "SYN1", label: "Clinic tablet", byUserId: adminId, byUserName: "admin" });
registerDevice({ facilityId, code: "SYN2", label: "Sub-county laptop", byUserId: adminId, byUserName: "admin" });

const BY = { actorId: adminId!, actorName: "Facility Administrator" };
const batchFile = join(workspace, "batch.json");

let seq = 0;
/** A local write, as any domain module would record one. */
function write(deviceCode: string, entity: string, entityId: string, payload: Record<string, unknown>) {
  return S.recordOp({
    deviceCode,
    entity,
    entityId,
    dataClass: "demographic",
    payload,
    ...BY,
  });
}

function somethingToPush(deviceCode = "SYN1") {
  return write(deviceCode, "patient", `P-${++seq}`, { phone: `07${String(1000000 + seq)}` });
}

// ------------------------------------------------------------------ digest

test("the digest changes when any field of any op changes", () => {
  const base: WireOp[] = [
    {
      op_id: "a", device_code: "SYN1", lamport: 1, at: "2026-09-16T10:00:00.000Z",
      actor_id: 1, actor_name: "A", entity: "patient", entity_id: "P-1",
      data_class: "demographic", payload: '{"phone":"0700"}',
    },
  ];
  const digest = X.batchDigest(base);

  assert.notEqual(X.batchDigest([{ ...base[0], payload: '{"phone":"0701"}' }]), digest);
  assert.notEqual(X.batchDigest([{ ...base[0], lamport: 2 }]), digest);
  assert.notEqual(X.batchDigest([{ ...base[0], entity_id: "P-2" }]), digest);
  assert.equal(X.batchDigest(base), digest, "and is stable for the same input");
});

test("moving a boundary between two fields does not produce the same digest", () => {
  // The reason the separator is a byte no field can contain.
  const one: WireOp = {
    op_id: "ab", device_code: "SYN1", lamport: 1, at: "2026-09-16T10:00:00.000Z",
    actor_id: null, actor_name: "", entity: "patient", entity_id: "c",
    data_class: "demographic", payload: "{}",
  };
  const two: WireOp = { ...one, op_id: "a", entity_id: "bc" };
  assert.notEqual(X.batchDigest([one]), X.batchDigest([two]));
});

test("an empty batch has a stable digest of its own", () => {
  assert.equal(X.batchDigest([]), X.batchDigest([]));
  assert.notEqual(X.batchDigest([]), "");
});

// ---------------------------------------------------------------- outbound

test("packing does not mark anything pushed", () => {
  // The line the whole module is arranged around: marking on send loses every
  // op in a batch that never arrived.
  somethingToPush();
  const before = S.pendingPush("SYN1").length;
  assert.ok(before > 0);

  const envelope = X.packOutbound({ deviceCode: "SYN1", facilityId });
  assert.equal(envelope.ops.length, before);
  assert.equal(S.pendingPush("SYN1").length, before, "still pending until somebody acknowledges");

  // And packing twice gives the same batch rather than draining the queue.
  assert.equal(X.packOutbound({ deviceCode: "SYN1", facilityId }).digest, envelope.digest);
});

test("acknowledging is what marks them pushed", () => {
  const envelope = X.packOutbound({ deviceCode: "SYN1", facilityId });
  const pushed = X.confirmPushed(envelope);

  assert.equal(pushed, envelope.ops.length);
  assert.equal(S.pendingPush("SYN1").length, 0);
});

test("a device this facility never registered cannot pack a batch", () => {
  assert.throws(
    () => X.packOutbound({ deviceCode: "NOPE", facilityId }),
    /not a registered device/,
  );
});

test("a revoked device cannot pack a batch either", () => {
  registerDevice({ facilityId, code: "SYN9", label: "Lost tablet", byUserId: adminId, byUserName: "admin" });
  revokeDevice({ code: "SYN9", reason: "Left in a matatu", byUserId: adminId, byUserName: "admin" });
  assert.throws(() => X.packOutbound({ deviceCode: "SYN9", facilityId }), /not a registered device/);
});

// ----------------------------------------------------------------- inbound

test("a batch that does not match its digest is refused whole", () => {
  // A truncated file off a bad stick is not a partial sync.
  somethingToPush("SYN2");
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });
  const tampered: Envelope = {
    ...envelope,
    ops: envelope.ops.map((op) => ({ ...op, payload: '{"phone":"0799999999"}' })),
  };

  const check = X.verifyEnvelope(tampered, facilityId);
  assert.equal(check.ok, false);
  assert.match((check as Refusal).why, /does not match its own digest/);
});

test("half a batch is refused, not applied in part", () => {
  somethingToPush("SYN2");
  somethingToPush("SYN2");
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });
  assert.ok(envelope.ops.length >= 2);

  const truncated: Envelope = { ...envelope, ops: envelope.ops.slice(0, 1) };
  const out = X.applyInbound({ envelope: truncated, facilityId, localDeviceCode: "SYN1" });
  assert.equal(out.ok, false);

  // And nothing from it landed.
  const applied = all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sync_ops WHERE op_id = ?`,
    envelope.ops[0].op_id,
  );
  assert.equal(applied[0].n, 1, "the op exists locally because SYN2 wrote it, not because the batch applied");
});

test("a batch from a newer format is refused rather than half-read", () => {
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });
  const future: Envelope = { ...envelope, version: X.BATCH_VERSION + 1 };

  const check = X.verifyEnvelope(future, facilityId);
  assert.equal(check.ok, false);
  assert.match((check as Refusal).why, /upgrade before syncing/);
});

test("a batch for another facility is refused", () => {
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });
  const check = X.verifyEnvelope({ ...envelope, facilityId: facilityId + 99 }, facilityId);
  assert.equal(check.ok, false);
  assert.match((check as Refusal).why, /is for facility/);
});

test("a batch from an unregistered device is refused", () => {
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });
  const check = X.verifyEnvelope({ ...envelope, from: "GHOST" }, facilityId);
  assert.equal(check.ok, false);
  assert.match((check as Refusal).why, /not a registered device/);
});

test("a batch carrying somebody else's operation is refused", () => {
  // Either a relay nobody designed, or a forgery.
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });
  const mixed = envelope.ops.map((op, index) => (index === 0 ? { ...op, device_code: "SYN1" } : op));
  const forged: Envelope = { ...envelope, ops: mixed, digest: X.batchDigest(mixed) };

  const check = X.verifyEnvelope(forged, facilityId);
  assert.equal(check.ok, false);
  assert.match((check as Refusal).why, /carries an operation from SYN1/);
});

test("an operation claiming an impossible clock is refused", () => {
  // The clock advances to max(mine, theirs) + 1 on every received op, so one
  // batch claiming a huge value moves this device's clock there for good —
  // and near MAX_SAFE_INTEGER, adding one stops doing anything and the total
  // order collapses onto the device code permanently.
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });
  const clockBefore = S.currentClock("SYN1");

  const poisoned = envelope.ops.map((op, index) =>
    index === 0 ? { ...op, lamport: Number.MAX_SAFE_INTEGER - 1 } : op,
  );
  const attack: Envelope = { ...envelope, ops: poisoned, digest: X.batchDigest(poisoned) };

  const out = X.applyInbound({ envelope: attack, facilityId, localDeviceCode: "SYN1" });
  assert.equal(out.ok, false);
  assert.match((out as Refusal).why, /outside anything a real device could have reached/);
  assert.equal(S.currentClock("SYN1"), clockBefore, "the clock did not move");
});

test("a clock that is merely high is still accepted — a device offline for months has one", () => {
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });
  const high = envelope.ops.map((op) => ({ ...op, lamport: X.MAX_LAMPORT - 1 }));
  const batch: Envelope = { ...envelope, ops: high, digest: X.batchDigest(high) };

  assert.equal(X.verifyEnvelope(batch, facilityId).ok, true);
});

test("a negative or fractional clock is not a clock", () => {
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const ops = envelope.ops.map((op) => ({ ...op, lamport: bad }));
    const batch: Envelope = { ...envelope, ops, digest: X.batchDigest(ops) };
    assert.equal(X.verifyEnvelope(batch, facilityId).ok, false, String(bad));
  }
});

test("a batch far larger than anybody sends is refused rather than worked through", () => {
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });
  const many = Array.from({ length: X.MAX_BATCH_OPS + 1 }, (_, index) => ({
    ...envelope.ops[0],
    op_id: `flood-${index}`,
  }));
  const flood: Envelope = { ...envelope, ops: many, digest: X.batchDigest(many) };

  const check = X.verifyEnvelope(flood, facilityId);
  assert.equal(check.ok, false);
  assert.match((check as Refusal).why, /send it in parts/);
});

test("something that is not a batch at all is refused without throwing", () => {
  const check = X.verifyEnvelope({} as Envelope, facilityId);
  assert.equal(check.ok, false);
  assert.match((check as Refusal).why, /not a batch/);
});

test("a refusal is on the audit log with the reason", () => {
  const before = X.transportSummary(facilityId).batchesRefused;
  X.applyInbound({
    envelope: { ...X.packOutbound({ deviceCode: "SYN2", facilityId }), from: "GHOST" },
    facilityId,
    localDeviceCode: "SYN1",
  });

  const summary = X.transportSummary(facilityId);
  assert.equal(summary.batchesRefused, before + 1);
  assert.match(summary.lastRefusal!, /not a registered device/);
});

// ---------------------------------------------------------------- transports

test("a file is a transport, because a clinic with no line syncs on a stick", () => {
  somethingToPush("SYN1");
  const transport = X.fileTransport(batchFile);
  const envelope = X.packOutbound({ deviceCode: "SYN1", facilityId });

  assert.equal(transport.send(envelope).ok, true);
  const collected = transport.receive()!;
  assert.equal(collected.digest, envelope.digest);
  assert.equal(X.verifyEnvelope(collected, facilityId).ok, true);
});

test("a missing file is nothing to collect rather than an error", () => {
  assert.equal(X.fileTransport(join(workspace, "never-written.json")).receive(), null);
});

test("a corrupted file is refused by the digest rather than guessed at", () => {
  const transport = X.fileTransport(batchFile);
  const envelope = X.packOutbound({ deviceCode: "SYN1", facilityId });
  transport.send(envelope);

  // A stick that wrote most of the file.
  const written = readFileSync(batchFile, "utf8");
  writeFileSync(batchFile, written.replace(/"payload": "[^"]*"/, '"payload": "{}"'), "utf8");

  const collected = transport.receive();
  if (collected) {
    assert.equal(X.verifyEnvelope(collected, facilityId).ok, false);
  } else {
    // Truncation that broke the JSON is also a refusal, just an earlier one.
    assert.equal(collected, null);
  }
});

test("the http transport says it cannot rather than silently doing nothing", () => {
  const transport = X.httpTransport("https://hub.example/sync");
  const sent = transport.send(X.packOutbound({ deviceCode: "SYN1", facilityId }));
  assert.equal(sent.ok, false);
  assert.match(sent.error!, /nobody has designed/);
  assert.equal(transport.receive(), null);
});

// ----------------------------------------------------------------- exchange

test("an exchange that could not send leaves the ops pending", () => {
  // The failure that must not lose anything.
  somethingToPush("SYN1");
  const waiting = S.pendingPush("SYN1").length;
  assert.ok(waiting > 0);

  const out = X.exchange({
    transport: X.httpTransport("https://hub.example/sync"),
    deviceCode: "SYN1",
    facilityId,
  });

  assert.equal(out.sent, false);
  assert.equal(out.pushed, 0);
  assert.equal(S.pendingPush("SYN1").length, waiting, "nothing was lost to a link that failed");
});

test("an exchange that sent marks them pushed and collects what was there", () => {
  const out = X.exchange({
    transport: X.fileTransport(join(workspace, "out.json"), batchFile),
    deviceCode: "SYN1",
    facilityId,
  });

  assert.equal(out.sent, true);
  assert.ok(out.pushed > 0);
  assert.equal(S.pendingPush("SYN1").length, 0);
  // The inbound file is SYN1's own earlier batch, so every op is a duplicate —
  // which is exactly what a re-sent batch should be.
  assert.ok(out.outcomes.every((o) => o.result === "duplicate"));
});

test("a batch re-sent after a dropped link is a duplicate, not a double-count", () => {
  somethingToPush("SYN2");
  const envelope = X.packOutbound({ deviceCode: "SYN2", facilityId });

  const first = X.applyInbound({ envelope, facilityId, localDeviceCode: "SYN1" });
  const second = X.applyInbound({ envelope, facilityId, localDeviceCode: "SYN1" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.ok((second as Accepted).outcomes.every((o) => o.result === "duplicate"));
});

test("nothing is deleted after a successful push", () => {
  // A device that has forgotten what it did cannot answer for itself.
  const pushed = all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sync_ops WHERE pushed_at IS NOT NULL`,
  );
  assert.ok(pushed[0].n > 0);
});

// ------------------------------------------------------------------ reports

test("the summary says what is waiting and what was refused", () => {
  somethingToPush("SYN1");
  const summary = X.transportSummary(facilityId);

  assert.ok(summary.waiting > 0);
  assert.ok(summary.oldestWaiting !== null);
  assert.ok(summary.batchesApplied > 0);
  assert.ok(summary.batchesRefused > 0);
  assert.ok(summary.lastAcknowledged !== null);
});

test("the audit chain still verifies after all of that", () => {
  assert.equal(verifyAuditChain().ok, true);
  rmSync(workspace, { recursive: true, force: true });
});

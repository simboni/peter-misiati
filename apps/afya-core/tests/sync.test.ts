/**
 * M03 Sync Engine.
 *
 * The convergence test is the one that earns this module its place: the same
 * ops delivered in a different order must produce the same state. A flapping
 * link on a Kenyan clinic's router delivers out of order routinely, and a merge
 * that is order-sensitive silently diverges two devices' records of one patient.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-sync-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const S = await import("../src/lib/sync.ts");
const { all, get } = await import("../src/lib/db.ts");

type Incoming = Parameters<typeof S.receiveOps>[0][number];

let seq = 0;
function remoteOp(over: Partial<Incoming> & { lamport: number; device_code: string }): Incoming {
  seq++;
  return {
    op_id: over.op_id ?? `${over.device_code}-OP${String(seq).padStart(4, "0")}`,
    device_code: over.device_code,
    lamport: over.lamport,
    at: over.at ?? new Date(Date.now() + seq * 1000).toISOString(),
    actor_id: null,
    actor_name: over.actor_name ?? "remote",
    entity: over.entity ?? "patient",
    entity_id: over.entity_id ?? "P-1",
    data_class: over.data_class ?? "demographic",
    payload: over.payload ?? "{}",
  };
}

test("ordering is by Lamport clock, with the device code as a stable tie-break", () => {
  const a = { lamport: 5, device_code: "TAB1" };
  const b = { lamport: 6, device_code: "TAB1" };
  const c = { lamport: 5, device_code: "TAB2" };

  assert.ok(S.compareOps(a, b) < 0, "a lower clock comes first");
  assert.ok(S.compareOps(a, c) < 0, "a tie is broken by device code, not by chance");
  assert.equal(S.compareOps(a, a), 0);

  // Every device must compute the same order from the same set.
  const set = [b, c, a];
  const order1 = [...set].sort(S.compareOps).map((o) => `${o.device_code}:${o.lamport}`);
  const order2 = [...set].reverse().sort(S.compareOps).map((o) => `${o.device_code}:${o.lamport}`);
  assert.deepEqual(order1, order2, "sorting is total and deterministic");
});

test("a local write records an op and advances this device's clock", () => {
  const before = S.currentClock("TAB1");
  const op = S.recordOp({
    deviceCode: "TAB1",
    entity: "patient",
    entityId: "P-LOCAL",
    dataClass: "demographic",
    payload: { phone: "254712345678" },
    actorName: "Joseph Otieno",
  });

  assert.equal(op.device_code, "TAB1");
  assert.ok(op.lamport > before, "the clock moves forward on every local write");
  assert.match(op.op_id, /^TAB1-/, "the op id carries the minting device");
  assert.equal(S.pendingPush("TAB1").length, 1, "it is queued for push");
});

test("pushed ops leave the queue", () => {
  const pending = S.pendingPush("TAB1");
  S.markPushed(pending.map((o) => o.op_id));
  assert.equal(S.pendingPush("TAB1").length, 0);
});

test("receiving an op advances our clock past theirs", () => {
  const before = S.currentClock("TAB1");
  S.receiveOps([remoteOp({ device_code: "TAB2", lamport: before + 50, payload: JSON.stringify({ ward: "Kamukunji" }) })], "TAB1");
  assert.ok(S.currentClock("TAB1") > before + 50, "our next write must order after everything we have seen");
});

test("applying the same op twice is a no-op", () => {
  const op = remoteOp({ device_code: "TAB2", lamport: 200, entity_id: "P-DUP", payload: JSON.stringify({ phone: "254700111222" }) });

  const first = S.receiveOps([op], "TAB1");
  assert.equal(first.outcomes[0].result, "applied");

  const second = S.receiveOps([op], "TAB1");
  assert.equal(second.outcomes[0].result, "duplicate", "a retry on a bad link must not apply twice");

  const rows = all<{ n: number }>(`SELECT COUNT(*) AS n FROM sync_ops WHERE op_id = ?`, op.op_id);
  assert.equal(rows[0].n, 1);
});

test("demographic fields merge per field — a correction does not drag stale values", () => {
  // Reception fixes the phone; a nurse on another tablet fixes the village.
  const phoneOp = remoteOp({
    device_code: "TAB2",
    lamport: 300,
    entity_id: "P-MERGE",
    payload: JSON.stringify({ phone: "254722000111" }),
  });
  const villageOp = remoteOp({
    device_code: "TAB3",
    lamport: 301,
    entity_id: "P-MERGE",
    payload: JSON.stringify({ village: "Mwiki" }),
  });

  const { state } = S.receiveOps([phoneOp, villageOp], "TAB1");
  const fields = state.get("patient:P-MERGE")!;

  assert.equal(fields.get("phone")!.value, "254722000111", "both edits survive");
  assert.equal(fields.get("village")!.value, "Mwiki");
});

test("a late-arriving older edit does not overwrite a newer one", () => {
  const newer = remoteOp({
    device_code: "TAB2",
    lamport: 400,
    entity_id: "P-LATE",
    payload: JSON.stringify({ phone: "254733999888" }),
  });
  S.receiveOps([newer], "TAB1");

  // The same field, written earlier, arriving later because the link flapped.
  const older = remoteOp({
    device_code: "TAB3",
    lamport: 399,
    entity_id: "P-LATE",
    payload: JSON.stringify({ phone: "254700000000" }),
  });
  const { outcomes, state } = S.receiveOps([older], "TAB1");

  assert.equal(outcomes[0].result, "superseded", "the stale value must lose");
  assert.equal(state.get("patient:P-LATE")?.get("phone"), undefined, "and must not appear in merged state");
});

test("the same ops in any delivery order converge on the same state", () => {
  const ops = [
    remoteOp({ op_id: "X-1", device_code: "TAB2", lamport: 500, entity_id: "P-CONV", payload: JSON.stringify({ phone: "254700000001" }) }),
    remoteOp({ op_id: "X-2", device_code: "TAB3", lamport: 501, entity_id: "P-CONV", payload: JSON.stringify({ phone: "254700000002" }) }),
    remoteOp({ op_id: "X-3", device_code: "TAB2", lamport: 502, entity_id: "P-CONV", payload: JSON.stringify({ village: "Kibera" }) }),
    remoteOp({ op_id: "X-4", device_code: "TAB4", lamport: 501, entity_id: "P-CONV", payload: JSON.stringify({ county: "Nairobi" }) }),
  ];

  // Deliver in order.
  const inOrder = S.receiveOps(ops, "TAB1");
  const a = inOrder.state.get("patient:P-CONV")!;

  // A second entity, same ops, delivered backwards.
  const shuffled = ops
    .map((o) => ({ ...o, op_id: o.op_id + "R", entity_id: "P-CONV-R" }))
    .reverse();
  const outOfOrder = S.receiveOps(shuffled, "TAB1");
  const b = outOfOrder.state.get("patient:P-CONV-R")!;

  assert.equal(a.get("phone")!.value, "254700000002", "the highest-ordered write to phone wins");
  assert.equal(
    a.get("phone")!.value,
    b.get("phone")!.value,
    "delivery order must not change the outcome — a flapping link is normal",
  );
  assert.equal(a.get("village")!.value, b.get("village")!.value);
  assert.equal(a.get("county")!.value, b.get("county")!.value);
});

test("a clinical conflict keeps both versions and asks a person to look", () => {
  const roomA = remoteOp({
    device_code: "TAB2",
    lamport: 600,
    entity: "encounter",
    entity_id: "E-1",
    data_class: "clinical",
    payload: JSON.stringify({ assessment: "Malaria, uncomplicated" }),
  });
  const roomB = remoteOp({
    device_code: "TAB3",
    lamport: 601,
    entity: "encounter",
    entity_id: "E-1",
    data_class: "clinical",
    payload: JSON.stringify({ assessment: "Viral illness, observe" }),
  });

  S.receiveOps([roomA], "TAB1");
  const second = S.receiveOps([roomB], "TAB1");

  assert.equal(second.outcomes[0].result, "conflict");
  assert.equal(
    second.outcomes[0].result === "conflict" && second.outcomes[0].resolution,
    "both-kept",
    "clinical content is never silently overwritten",
  );

  const open = S.openConflicts("clinical");
  assert.ok(open.some((c) => c.entity_id === "E-1"), "it waits for a clinician, not for a timeout");

  // Both ops survive in the log, so both versions remain recoverable.
  const kept = all<{ payload: string }>(
    `SELECT payload FROM sync_ops WHERE entity = 'encounter' AND entity_id = 'E-1'`,
  );
  assert.equal(kept.length, 2);
  assert.ok(kept.some((k) => k.payload.includes("Malaria")));
  assert.ok(kept.some((k) => k.payload.includes("Viral")));
});

test("a reviewed clinical conflict leaves the queue and lands in the audit log", () => {
  const open = S.openConflicts("clinical").find((c) => c.entity_id === "E-1")!;
  S.reviewConflict({ id: open.id, byUserId: null, byUserName: "Dr. Wanjiru", note: "kept malaria, confirmed by RDT" });

  assert.ok(
    !S.openConflicts("clinical").some((c) => c.id === open.id),
    "once reviewed it must stop nagging",
  );
  const entry = get<{ action: string; detail: string }>(
    `SELECT action, detail FROM audit_log ORDER BY id DESC LIMIT 1`,
  )!;
  assert.equal(entry.action, "sync_conflict_reviewed");
  assert.match(entry.detail, /RDT/);
});

test("a ledger conflict lets the server win but records the variance", () => {
  // This device recorded a local stock movement while offline.
  S.recordOp({
    deviceCode: "TAB1",
    entity: "stock",
    entityId: "ITEM-7",
    dataClass: "ledger",
    payload: { qty: 40 },
    actorName: "Pharmacy",
  });

  const fromServer = remoteOp({
    device_code: "SRV",
    lamport: 700,
    entity: "stock",
    entity_id: "ITEM-7",
    data_class: "ledger",
    payload: JSON.stringify({ qty: 38 }),
  });
  const { outcomes, state } = S.receiveOps([fromServer], "TAB1");

  assert.equal(outcomes[0].result, "conflict");
  assert.equal(
    outcomes[0].result === "conflict" && outcomes[0].resolution,
    "server-wins",
    "the server is authoritative for stock and money",
  );
  assert.equal(state.get("stock:ITEM-7")!.get("qty")!.value, 38);

  const variance = S.openConflicts("all").find((c) => c.entity_id === "ITEM-7")!;
  assert.ok(variance, "the discrepancy is logged for the accountant, never dropped");
  assert.equal(variance.resolution, "server-wins");
});

test("a canonical identifier never erases the provisional one", () => {
  // A receipt was numbered on the device while offline; eTIMS later assigns the
  // real invoice number. The patient is holding a slip with the first one.
  const assign = remoteOp({
    device_code: "SRV",
    lamport: 800,
    entity: "invoice",
    entity_id: "TAB1-9F3K2M",
    data_class: "identifier",
    payload: JSON.stringify({ canonical_number: "KRA-INV-0000481", provisional_number: "TAB1-9F3K2M" }),
  });
  const { state } = S.receiveOps([assign], "TAB1");
  const fields = state.get("invoice:TAB1-9F3K2M")!;

  assert.equal(fields.get("canonical_number")!.value, "KRA-INV-0000481");
  assert.equal(
    fields.get("provisional_number")!.value,
    "TAB1-9F3K2M",
    "the number on the patient's paper slip must keep resolving",
  );
});

test("sync status reports what the offline indicator needs", () => {
  S.recordOp({
    deviceCode: "TAB1",
    entity: "patient",
    entityId: "P-STATUS",
    dataClass: "demographic",
    payload: { phone: "254799888777" },
  });

  const status = S.syncStatus("TAB1");
  assert.equal(status.deviceCode, "TAB1");
  assert.ok(status.pending >= 1, "the queue depth is what tells staff they are offline");
  assert.ok(status.clock > 0);

  S.markSynced("TAB1");
  assert.ok(S.syncStatus("TAB1").lastSyncedAt, "and when it last got through");
});

/**
 * M03 Sync Engine — offline-first writes and convergent merge.
 *
 * The product promise is that a clinic keeps working for three days with no
 * connectivity and loses nothing. That is not a feature you add later; it is a
 * property of how every write is recorded, which is why this module exists
 * before anything that writes.
 *
 * Three decisions carry the design:
 *
 *  1. ORDER COMES FROM A LAMPORT CLOCK, NOT THE WALL CLOCK.
 *     Two tablets in one clinic have drifting clocks and at least one was set by
 *     hand. Wall time would let a device with a fast clock win every conflict
 *     forever. Each device keeps a counter, bumps it on every local write, and
 *     on receiving a remote op sets its counter to max(mine, theirs) + 1. Total
 *     order is (lamport, device_code) — device_code breaks ties deterministically
 *     so every device computes the same order.
 *
 *  2. AN OP CARRIES CHANGED FIELDS, NEVER A WHOLE ROW.
 *     A device that has been offline for two days holds a stale copy. If it
 *     pushed whole rows it would silently revert every field someone else
 *     changed meanwhile. Field-level ops make that impossible.
 *
 *  3. CONFLICT RESOLUTION DEPENDS ON WHAT THE DATA IS.
 *     There is no single correct rule, and pretending otherwise is how systems
 *     lose clinical notes:
 *
 *       clinical     Never lose data. Both versions are kept and a human
 *                    reviews. Two clinicians documenting the same encounter
 *                    from different rooms are both telling the truth.
 *       ledger       Stock and money. The server is authoritative and the
 *                    device reconciles; the variance is logged, never dropped.
 *       demographic  Field-level last-writer-wins. A corrected phone number
 *                    should win; it should not drag a stale address with it.
 *       identifier   Provisional and canonical both retained. The number on the
 *                    patient's paper slip must keep resolving forever.
 *
 * Applying an op is idempotent. Retries are normal on a bad link, and a retry
 * that double-applied a stock movement would be a real-world loss.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";
import { mintLocalId, assertDeviceCode } from "./ids.ts";

export class SyncError extends Error {}

/** How a conflict on this data is resolved. See rule 3 above. */
export type DataClass = "clinical" | "ledger" | "demographic" | "identifier";

export interface Op {
  op_id: string;
  device_code: string;
  lamport: number;
  at: string;
  actor_id: number | null;
  actor_name: string;
  entity: string;
  entity_id: string;
  data_class: DataClass;
  /** JSON string of changed fields only. */
  payload: string;
  origin: "local" | "remote";
  status: "pending" | "applied" | "superseded";
  applied_at: string | null;
  pushed_at: string | null;
}

// ------------------------------------------------------------ Lamport clock

/**
 * Total order across devices.
 *
 * Lamport first, then device code as a deterministic tie-break. Every device
 * computes the same order from the same set of ops, which is what makes the
 * merge convergent rather than merely plausible.
 */
export function compareOps(
  a: { lamport: number; device_code: string },
  b: { lamport: number; device_code: string },
): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  return a.device_code < b.device_code ? -1 : a.device_code > b.device_code ? 1 : 0;
}

function clockFor(deviceCode: string): number {
  const row = get<{ lamport: number }>(`SELECT lamport FROM sync_state WHERE device_code = ?`, deviceCode);
  if (row) return row.lamport;
  run(`INSERT INTO sync_state (device_code, lamport) VALUES (?, 0)`, deviceCode);
  return 0;
}

function bumpClock(deviceCode: string, atLeast = 0): number {
  const next = Math.max(clockFor(deviceCode), atLeast) + 1;
  run(
    `INSERT INTO sync_state (device_code, lamport) VALUES (?, ?)
     ON CONFLICT(device_code) DO UPDATE SET lamport = excluded.lamport`,
    deviceCode,
    next,
  );
  return next;
}

/** This device's current clock — exposed for diagnostics and tests. */
export function currentClock(deviceCode: string): number {
  return clockFor(deviceCode);
}

// -------------------------------------------------------------- recording

/**
 * Record a local change.
 *
 * Called inside the same transaction as the change it describes, so a write can
 * never exist without its operation — that pair is what lets a device replay
 * itself to the server after three days offline.
 */
export function recordOp(input: {
  deviceCode: string;
  entity: string;
  entityId: string;
  dataClass: DataClass;
  payload: Record<string, unknown>;
  actorId?: number | null;
  actorName?: string;
}): Op {
  assertDeviceCode(input.deviceCode);

  const lamport = bumpClock(input.deviceCode);
  const op: Op = {
    op_id: mintLocalId(input.deviceCode, 10),
    device_code: input.deviceCode,
    lamport,
    at: now(),
    actor_id: input.actorId ?? null,
    actor_name: input.actorName ?? "system",
    entity: input.entity,
    entity_id: input.entityId,
    data_class: input.dataClass,
    payload: JSON.stringify(input.payload),
    origin: "local",
    // A local op is already reflected in local state; it is pending only in the
    // sense that it has not been pushed.
    status: "applied",
    applied_at: now(),
    pushed_at: null,
  };

  run(
    `INSERT INTO sync_ops
       (op_id, device_code, lamport, at, actor_id, actor_name, entity, entity_id,
        data_class, payload, origin, status, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    op.op_id,
    op.device_code,
    op.lamport,
    op.at,
    op.actor_id,
    op.actor_name,
    op.entity,
    op.entity_id,
    op.data_class,
    op.payload,
    op.origin,
    op.status,
    op.applied_at,
  );

  return op;
}

/** Ops this device has not yet pushed, in causal order. */
export function pendingPush(deviceCode?: string): Op[] {
  const rows = deviceCode
    ? all<Op>(`SELECT * FROM sync_ops WHERE origin = 'local' AND pushed_at IS NULL AND device_code = ?`, deviceCode)
    : all<Op>(`SELECT * FROM sync_ops WHERE origin = 'local' AND pushed_at IS NULL`);
  return rows.sort(compareOps);
}

/** Mark ops as pushed, once the server has acknowledged them. */
export function markPushed(opIds: string[]): void {
  const at = now();
  tx(() => {
    for (const id of opIds) {
      run(`UPDATE sync_ops SET pushed_at = ? WHERE op_id = ?`, at, id);
    }
  });
}

// ------------------------------------------------------------- applying

/** What the merge decided for one incoming op. */
export type ApplyOutcome =
  | { opId: string; result: "applied" }
  /** Already seen. Retries are normal; double-applying a stock move is not. */
  | { opId: string; result: "duplicate" }
  /** An older op arriving late that a newer one already overrode, field by field. */
  | { opId: string; result: "superseded"; byOpId: string }
  /** Kept, and flagged: a person must reconcile the two versions. */
  | { opId: string; result: "conflict"; resolution: "both-kept" | "server-wins" | "field-merged" };

export interface MergedField {
  field: string;
  value: unknown;
  /** The op whose value won. */
  fromOpId: string;
}

/**
 * Apply a batch of remote ops.
 *
 * Returns what happened to each, and the resulting field state per entity so the
 * caller (a domain module, e.g. patients.ts) can write it into its own tables.
 * This module owns ordering and conflict policy; it does not know what a patient
 * is, and should not.
 */
export function receiveOps(
  incoming: Omit<Op, "origin" | "status" | "applied_at" | "pushed_at">[],
  localDeviceCode: string,
): { outcomes: ApplyOutcome[]; state: Map<string, Map<string, MergedField>> } {
  const outcomes: ApplyOutcome[] = [];
  const state = new Map<string, Map<string, MergedField>>();

  // Causal order first: applying out of order is the whole problem.
  const ordered = [...incoming].sort(compareOps);

  tx(() => {
    for (const op of ordered) {
      const seen = get<{ op_id: string }>(`SELECT op_id FROM sync_ops WHERE op_id = ?`, op.op_id);
      if (seen) {
        outcomes.push({ opId: op.op_id, result: "duplicate" });
        continue;
      }

      // Receiving advances our clock past theirs, so our next local write is
      // ordered after everything we have seen.
      bumpClock(localDeviceCode, op.lamport);

      const outcome = applyOne(op, state);
      outcomes.push(outcome);

      run(
        `INSERT INTO sync_ops
           (op_id, device_code, lamport, at, actor_id, actor_name, entity, entity_id,
            data_class, payload, origin, status, applied_at, pushed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'remote', ?, ?, ?)`,
        op.op_id,
        op.device_code,
        op.lamport,
        op.at,
        op.actor_id,
        op.actor_name,
        op.entity,
        op.entity_id,
        op.data_class,
        op.payload,
        outcome.result === "superseded" ? "superseded" : "applied",
        now(),
        // A remote op needs no pushing back.
        now(),
      );
    }
  });

  return { outcomes, state };
}

function key(entity: string, entityId: string): string {
  return `${entity}:${entityId}`;
}

function applyOne(
  op: Omit<Op, "origin" | "status" | "applied_at" | "pushed_at">,
  state: Map<string, Map<string, MergedField>>,
): ApplyOutcome {
  const k = key(op.entity, op.entity_id);
  if (!state.has(k)) state.set(k, new Map());
  const fields = state.get(k)!;

  const payload = JSON.parse(op.payload) as Record<string, unknown>;

  // Ops already recorded against this entity, so a late arrival can be compared
  // against what actually won.
  const prior = all<Op>(
    `SELECT * FROM sync_ops WHERE entity = ? AND entity_id = ? AND status = 'applied'`,
    op.entity,
    op.entity_id,
  );

  switch (op.data_class) {
    case "clinical": {
      // Never overwrite. If anyone else has written clinical content for this
      // entity, both versions stand and a person reconciles them.
      const competing = prior.filter((p) => p.device_code !== op.device_code && p.data_class === "clinical");
      for (const [field, value] of Object.entries(payload)) {
        fields.set(field, { field, value, fromOpId: op.op_id });
      }
      if (competing.length > 0) {
        recordConflict({
          entity: op.entity,
          entityId: op.entity_id,
          field: null,
          dataClass: "clinical",
          keptOpId: op.op_id,
          otherOpId: competing[competing.length - 1].op_id,
          resolution: "both-kept",
        });
        return { opId: op.op_id, result: "conflict", resolution: "both-kept" };
      }
      return { opId: op.op_id, result: "applied" };
    }

    case "ledger": {
      // The server is authoritative. A device's own competing view is recorded
      // as a variance to be reconciled, never silently discarded.
      const localCompeting = prior.filter((p) => p.origin === "local" && p.data_class === "ledger");
      for (const [field, value] of Object.entries(payload)) {
        fields.set(field, { field, value, fromOpId: op.op_id });
      }
      if (localCompeting.length > 0) {
        recordConflict({
          entity: op.entity,
          entityId: op.entity_id,
          field: null,
          dataClass: "ledger",
          keptOpId: op.op_id,
          otherOpId: localCompeting[localCompeting.length - 1].op_id,
          resolution: "server-wins",
        });
        return { opId: op.op_id, result: "conflict", resolution: "server-wins" };
      }
      return { opId: op.op_id, result: "applied" };
    }

    case "identifier": {
      // Both numbers are kept. The provisional one is on paper in a patient's
      // hand and must never stop resolving.
      for (const [field, value] of Object.entries(payload)) {
        fields.set(field, { field, value, fromOpId: op.op_id });
      }
      return { opId: op.op_id, result: "applied" };
    }

    case "demographic":
    default: {
      // Field-level last-writer-wins. A later correction to one field must not
      // drag stale values for the others along with it.
      let anyWon = false;
      let supersededBy = "";

      for (const [field, value] of Object.entries(payload)) {
        const winner = latestWriterFor(prior, field, op);
        if (winner === null) {
          fields.set(field, { field, value, fromOpId: op.op_id });
          anyWon = true;
        } else {
          supersededBy = winner.op_id;
        }
      }

      if (!anyWon && supersededBy) {
        return { opId: op.op_id, result: "superseded", byOpId: supersededBy };
      }
      return { opId: op.op_id, result: "applied" };
    }
  }
}

/**
 * The op that already wrote `field` with a later position than `candidate`, or
 * null when the candidate wins.
 */
function latestWriterFor(
  prior: Op[],
  field: string,
  candidate: { lamport: number; device_code: string },
): Op | null {
  let winner: Op | null = null;
  for (const p of prior) {
    let touched: Record<string, unknown>;
    try {
      touched = JSON.parse(p.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!(field in touched)) continue;
    if (compareOps(p, candidate) > 0 && (!winner || compareOps(p, winner) > 0)) {
      winner = p;
    }
  }
  return winner;
}

// ------------------------------------------------------------- conflicts

function recordConflict(input: {
  entity: string;
  entityId: string;
  field: string | null;
  dataClass: DataClass;
  keptOpId: string;
  otherOpId: string;
  resolution: "both-kept" | "server-wins" | "field-merged";
}): void {
  run(
    `INSERT INTO sync_conflicts
       (entity, entity_id, field, data_class, kept_op_id, other_op_id, resolution, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.entity,
    input.entityId,
    input.field,
    input.dataClass,
    input.keptOpId,
    input.otherOpId,
    input.resolution,
    now(),
  );
}

export interface ConflictRow {
  id: number;
  entity: string;
  entity_id: string;
  field: string | null;
  data_class: DataClass;
  kept_op_id: string;
  other_op_id: string;
  resolution: string;
  detected_at: string;
  reviewed_at: string | null;
  reviewed_by: number | null;
}

/**
 * Conflicts still awaiting a person.
 *
 * Only clinical conflicts genuinely need review — a ledger variance is recorded
 * for the accountant and a demographic merge is already correct — so the default
 * is the list that actually blocks care.
 */
export function openConflicts(dataClass: DataClass | "all" = "clinical"): ConflictRow[] {
  return dataClass === "all"
    ? all<ConflictRow>(`SELECT * FROM sync_conflicts WHERE reviewed_at IS NULL ORDER BY detected_at`)
    : all<ConflictRow>(
        `SELECT * FROM sync_conflicts WHERE reviewed_at IS NULL AND data_class = ? ORDER BY detected_at`,
        dataClass,
      );
}

export function reviewConflict(input: {
  id: number;
  byUserId: number | null;
  byUserName: string;
  note?: string;
}): void {
  const conflict = get<ConflictRow>(`SELECT * FROM sync_conflicts WHERE id = ?`, input.id);
  if (!conflict) throw new SyncError("no such conflict");

  // 0 is never a valid rowid — treat it as "no user", the same way audit() does,
  // rather than failing a foreign key and rolling back the review.
  const reviewer = input.byUserId ? input.byUserId : null;

  tx(() => {
    run(`UPDATE sync_conflicts SET reviewed_at = ?, reviewed_by = ? WHERE id = ?`, now(), reviewer, input.id);
    audit({
      action: "sync_conflict_reviewed",
      entity: conflict.entity,
      entityId: conflict.entity_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: {
        conflictId: input.id,
        dataClass: conflict.data_class,
        resolution: conflict.resolution,
        note: input.note ?? "",
      },
    });
  });
}

// ----------------------------------------------------------------- status

export interface SyncStatus {
  deviceCode: string;
  clock: number;
  pending: number;
  openClinicalConflicts: number;
  lastSyncedAt: string | null;
}

/** What the offline indicator in the interface reads from. */
export function syncStatus(deviceCode: string): SyncStatus {
  const st = get<{ lamport: number; last_synced_at: string | null }>(
    `SELECT lamport, last_synced_at FROM sync_state WHERE device_code = ?`,
    deviceCode,
  );
  return {
    deviceCode,
    clock: st?.lamport ?? 0,
    pending: pendingPush(deviceCode).length,
    openClinicalConflicts: openConflicts("clinical").length,
    lastSyncedAt: st?.last_synced_at ?? null,
  };
}

export function markSynced(deviceCode: string): void {
  run(
    `INSERT INTO sync_state (device_code, lamport, last_synced_at) VALUES (?, ?, ?)
     ON CONFLICT(device_code) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
    deviceCode,
    clockFor(deviceCode),
    now(),
  );
}

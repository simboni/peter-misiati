/**
 * M03 Sync Engine, the transport half — moving operations between machines.
 *
 * `sync.ts` owns what an operation is, the Lamport ordering and the conflict
 * policy, and it is complete. What it has never had is anything that moves an
 * op from one machine to another, which is what this file is.
 *
 * The deployment that matters most in Kenya is not the one people design for.
 * A Level 2 clinic in Kayole loses connectivity for a day at a time and a
 * sub-county office two hours away wants the month's returns. The honest
 * transport for that is a file on a phone or a stick, carried — so the batch
 * format is a file first and a request body second, and both go through the
 * same four functions.
 *
 *  AN OP IS MARKED PUSHED ON ACKNOWLEDGEMENT, NEVER ON SENDING. `packOutbound`
 *  and `confirmPushed` are two calls on purpose. A dropped connection between
 *  them costs a duplicate batch, which the merge is idempotent against; doing
 *  it in one call costs the ops, which nothing can recover.
 *
 *  A BATCH THAT DOES NOT MATCH ITS DIGEST IS REFUSED WHOLE. A truncated file
 *  off a bad stick is not a partial sync. Half a batch applied in Lamport order
 *  looks exactly like a complete one until the missing half arrives and cannot
 *  be placed.
 *
 *  A BATCH FROM A DEVICE THIS FACILITY NEVER REGISTERED IS REFUSED. Device
 *  registration is what makes an offline-minted identifier unique, and an op
 *  from outside that registry can collide with one this facility issued.
 *
 *  A BATCH FROM A NEWER FORMAT IS REFUSED RATHER THAN HALF-READ. The field a
 *  reader does not understand is exactly the field that mattered.
 *
 *  A CLOCK NOBODY COULD HAVE REACHED IS REFUSED. The Lamport clock advances to
 *  whatever an incoming op claims, so one batch claiming a huge value moves
 *  this device's clock there for good — and near the top of the integer range,
 *  adding one stops doing anything and the total order collapses onto the
 *  device code permanently. One corrupt file would be enough.
 *
 *  NOTHING IS DELETED AFTER A SUCCESSFUL PUSH. The op log is the record of what
 *  this device did, and a device that has forgotten cannot answer for itself.
 *
 * ⚠️ No socket is opened. `fileTransport` is real and works — it is the
 * sneakernet a clinic with no line actually uses. `httpTransport` is declared
 * and refuses, exactly as the integration hub's live adapters do, because the
 * hub it would talk to has not been specified.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { all, get, audit, now } from "./db.ts";
import { pendingPush, markPushed, receiveOps, compareOps, type Op, type ApplyOutcome } from "./sync.ts";
import { activeDevice } from "./facility.ts";

export class TransportError extends Error {}

/**
 * The batch format version.
 *
 * Bumped when the envelope's shape changes. A reader refuses anything higher
 * than it knows, because the field it does not understand is the one that
 * mattered.
 */
export const BATCH_VERSION = 1;

/**
 * The highest Lamport value a batch may carry.
 *
 * The clock advances to max(mine, theirs) + 1 on every received op, so a single
 * batch claiming a huge value moves this device's clock there for good — and
 * near Number.MAX_SAFE_INTEGER, adding one stops doing anything, two ops share
 * a value and the total order collapses onto the device code permanently. One
 * corrupt file would be enough.
 *
 * 2^40 is about 1.1 trillion: a device writing one operation every millisecond
 * without pause would take thirty-five years to reach it, and it leaves four
 * thousand times that much headroom below the point where the arithmetic
 * breaks.
 */
export const MAX_LAMPORT = 2 ** 40;

/**
 * The most operations one batch may carry.
 *
 * `packOutbound` sends 500 at a time; this is the inbound ceiling, generous
 * enough for any honest sender and low enough that a malformed file is refused
 * rather than worked through.
 */
export const MAX_BATCH_OPS = 10_000;

/**
 * The largest file the folder listing will read.
 *
 * A batch at the operation ceiling is a few megabytes even with long clinical
 * notes. Anything at this size is not a batch, and reading it to find that out
 * would mean pulling whatever somebody left on the stick into memory.
 */
export const MAX_BATCH_BYTES = 32 * 1_048_576;

/** Separators for the digest, chosen because no field can contain them. */
const FIELD_SEPARATOR = "\u0000";
const OP_SEPARATOR = "\u0001";

/** An op as it travels. Local bookkeeping columns are deliberately not sent. */
export interface WireOp {
  op_id: string;
  device_code: string;
  lamport: number;
  at: string;
  actor_id: number | null;
  actor_name: string;
  entity: string;
  entity_id: string;
  data_class: Op["data_class"];
  payload: string;
}

export interface Envelope {
  version: number;
  /** The device that packed it. */
  from: string;
  facilityId: number;
  sentAt: string;
  ops: WireOp[];
  /** Digest over the ops, in order. What makes a truncated batch detectable. */
  digest: string;
}

/**
 * The digest a batch carries.
 *
 * Over the ops only, in their order, field by field with a separator that
 * cannot appear in a field — so two different batches cannot produce the same
 * digest by moving where one field ends and the next begins.
 */
export function batchDigest(ops: WireOp[]): string {
  const hash = createHash("sha256");
  for (const op of ops) {
    hash.update(
      [
        op.op_id,
        op.device_code,
        String(op.lamport),
        op.at,
        op.entity,
        op.entity_id,
        op.data_class,
        op.payload,
      ].join(FIELD_SEPARATOR),
    );
    hash.update(OP_SEPARATOR);
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------- outbound

/**
 * Everything this device has done that the other end has not acknowledged.
 *
 * Does NOT mark anything pushed. Packing twice is safe and normal — it is what
 * happens every time a link drops — and the merge at the other end is
 * idempotent, so a duplicate batch costs bandwidth and nothing else.
 */
export function packOutbound(input: {
  deviceCode: string;
  facilityId: number;
  limit?: number;
}): Envelope {
  const device = activeDevice(input.deviceCode);
  if (!device) throw new TransportError(`${input.deviceCode} is not a registered device on this facility`);

  const ops = pendingPush(device.code)
    .slice(0, input.limit ?? 500)
    .map(
      (op): WireOp => ({
        op_id: op.op_id,
        device_code: op.device_code,
        lamport: op.lamport,
        at: op.at,
        actor_id: op.actor_id,
        actor_name: op.actor_name,
        entity: op.entity,
        entity_id: op.entity_id,
        data_class: op.data_class,
        payload: op.payload,
      }),
    );

  return {
    version: BATCH_VERSION,
    from: device.code,
    facilityId: input.facilityId,
    sentAt: now(),
    ops,
    digest: batchDigest(ops),
  };
}

/**
 * Mark a batch's ops as pushed, once the other end has said it has them.
 *
 * Separate from packing, and that separation is the whole point: marking on
 * send loses every op in a batch that never arrived.
 */
export function confirmPushed(envelope: Envelope, byUserName = "sync"): number {
  const ids = envelope.ops.map((op) => op.op_id);
  if (ids.length === 0) return 0;

  markPushed(ids);
  audit({
    action: "sync_batch_acknowledged",
    entity: "sync",
    entityId: envelope.digest.slice(0, 12),
    facilityId: envelope.facilityId,
    actorName: byUserName,
    purpose: "administration",
    detail: { from: envelope.from, ops: ids.length, sentAt: envelope.sentAt },
  });
  return ids.length;
}

// ----------------------------------------------------------------- inbound

export interface Refusal {
  ok: false;
  why: string;
}

type MergedFieldState = { field: string; value: unknown; fromOpId: string };

export interface Accepted {
  ok: true;
  ops: number;
  outcomes: ApplyOutcome[];
  /** Field state per entity, for the domain module to write into its own tables. */
  state: Map<string, Map<string, MergedFieldState>>;
}

/**
 * Everything checked before a single op is applied.
 *
 * Refusal is whole-batch. There is no such thing as applying the half that
 * verified: ops are ordered, and a gap in the order is not visible until the
 * op that needed the missing one arrives and cannot be placed.
 */
export function verifyEnvelope(envelope: Envelope, facilityId: number): Refusal | { ok: true } {
  if (typeof envelope?.version !== "number") return { ok: false, why: "that is not a batch" };
  if (envelope.version > BATCH_VERSION) {
    return {
      ok: false,
      why: `this batch is format ${envelope.version} and this installation reads ${BATCH_VERSION} — upgrade before syncing, rather than reading half of it`,
    };
  }
  if (!Array.isArray(envelope.ops)) return { ok: false, why: "that batch carries no operations list" };
  if (envelope.ops.length > MAX_BATCH_OPS) {
    return {
      ok: false,
      why: `that batch carries ${envelope.ops.length} operations and the limit is ${MAX_BATCH_OPS} — send it in parts`,
    };
  }

  // The clock advances to whatever an op claims, so an op claiming an absurd
  // value moves this device's clock there for good. Checked here, at the edge,
  // because this is the only place an op arrives from outside.
  const outOfRange = envelope.ops.find(
    (op) => !Number.isSafeInteger(op.lamport) || op.lamport < 0 || op.lamport > MAX_LAMPORT,
  );
  if (outOfRange) {
    return {
      ok: false,
      why: `that batch carries an operation claiming clock ${outOfRange.lamport}, which is outside anything a real device could have reached — accepting it would move this device's clock there permanently`,
    };
  }

  if (envelope.facilityId !== facilityId) {
    return {
      ok: false,
      why: `that batch is for facility ${envelope.facilityId} and this is facility ${facilityId}`,
    };
  }

  // A device this facility never registered can mint identifiers that collide
  // with ones it issued itself.
  if (!activeDevice(envelope.from)) {
    return { ok: false, why: `${envelope.from} is not a registered device on this facility` };
  }

  // Every op must come from the device that packed the batch. A batch carrying
  // somebody else's ops is either a relay nobody designed or a forgery.
  const stranger = envelope.ops.find((op) => op.device_code !== envelope.from);
  if (stranger) {
    return {
      ok: false,
      why: `that batch is from ${envelope.from} but carries an operation from ${stranger.device_code}`,
    };
  }

  if (batchDigest(envelope.ops) !== envelope.digest) {
    return {
      ok: false,
      why: "that batch does not match its own digest — it arrived truncated or altered, and half of it is worse than none",
    };
  }

  return { ok: true };
}

/**
 * Verify a batch and merge it.
 *
 * The merge itself is `sync.ts`'s, unchanged: Lamport order, the conflict
 * policy per data class, idempotent on the op id. This adds only the checks
 * that a batch crossing a wire or a stick needs and a local write does not.
 */
export function applyInbound(input: {
  envelope: Envelope;
  facilityId: number;
  localDeviceCode: string;
  byUserName?: string;
}): Accepted | Refusal {
  const check = verifyEnvelope(input.envelope, input.facilityId);
  if (!check.ok) {
    audit({
      action: "sync_batch_refused",
      entity: "sync",
      entityId: String(input.envelope?.digest ?? "").slice(0, 12),
      facilityId: input.facilityId,
      actorName: input.byUserName ?? "sync",
      purpose: "administration",
      detail: { from: input.envelope?.from ?? null, ops: input.envelope?.ops?.length ?? 0, why: check.why },
    });
    return check;
  }

  const { outcomes, state } = receiveOps(input.envelope.ops, input.localDeviceCode);

  audit({
    action: "sync_batch_applied",
    entity: "sync",
    entityId: input.envelope.digest.slice(0, 12),
    facilityId: input.facilityId,
    actorName: input.byUserName ?? "sync",
    purpose: "administration",
    detail: {
      from: input.envelope.from,
      ops: input.envelope.ops.length,
      applied: outcomes.filter((o) => o.result === "applied").length,
      duplicates: outcomes.filter((o) => o.result === "duplicate").length,
      superseded: outcomes.filter((o) => o.result === "superseded").length,
      conflicts: outcomes.filter((o) => o.result === "conflict").length,
    },
  });

  return { ok: true, ops: input.envelope.ops.length, outcomes, state };
}

// --------------------------------------------------------------- transports

/**
 * Where a batch goes.
 *
 * Deliberately two methods and nothing else. A transport that needs more than
 * this is doing something the sync engine should be doing instead.
 */
export interface Transport {
  readonly name: string;
  send(envelope: Envelope): { ok: boolean; error?: string };
  receive(): Envelope | null;
}

/**
 * A file on a stick or a phone.
 *
 * Not a fallback. A clinic two hours from the sub-county office with no line
 * syncs this way, and a transport that only works over a network is a
 * transport that does not work here.
 */
export function fileTransport(outPath: string, inPath = outPath): Transport {
  return {
    name: `file:${outPath}`,
    send(envelope) {
      try {
        // The folder is a mount point that may not exist yet — a stick plugged
        // into a machine that has never synced is the normal first case, not an
        // error to report back to the person holding it.
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "could not write the batch" };
      }
    },
    receive() {
      try {
        return JSON.parse(readFileSync(inPath, "utf8")) as Envelope;
      } catch {
        // A missing file is "nothing to collect". An unreadable one is refused
        // downstream by the digest check rather than guessed at here.
        return null;
      }
    },
  };
}

/**
 * ⚠️ The hub this would talk to has not been specified.
 *
 * Declared and refusing, exactly as the integration hub's live adapters do,
 * because a transport that silently does nothing is worse than one that says
 * it cannot.
 */
export function httpTransport(url: string): Transport {
  return {
    name: `http:${url}`,
    send: () => ({
      ok: false,
      error: `no sync hub is specified — ${url} would be talking to something nobody has designed`,
    }),
    receive: () => null,
  };
}

/**
 * One exchange: send what is waiting, collect what is there.
 *
 * Push first. If the link dies between the two halves, this device has lost
 * nothing — its ops are still pending and go again next time.
 */
export function exchange(input: {
  transport: Transport;
  deviceCode: string;
  facilityId: number;
  byUserName?: string;
}): {
  pushed: number;
  sent: boolean;
  error?: string;
  received: number;
  refused?: string;
  outcomes: ApplyOutcome[];
} {
  const outbound = packOutbound({ deviceCode: input.deviceCode, facilityId: input.facilityId });
  const sent = input.transport.send(outbound);

  // Only on acknowledgement. This is the line the whole file is arranged around.
  const pushed = sent.ok ? confirmPushed(outbound, input.byUserName) : 0;

  const inbound = input.transport.receive();
  if (!inbound) {
    return { pushed, sent: sent.ok, error: sent.error, received: 0, outcomes: [] };
  }

  const applied = applyInbound({
    envelope: inbound,
    facilityId: input.facilityId,
    localDeviceCode: input.deviceCode,
    byUserName: input.byUserName,
  });

  return applied.ok
    ? { pushed, sent: sent.ok, error: sent.error, received: applied.ops, outcomes: applied.outcomes }
    : { pushed, sent: sent.ok, error: sent.error, received: 0, refused: applied.why, outcomes: [] };
}

// ------------------------------------------------------------------ reports

export interface TransportSummary {
  waiting: number;
  oldestWaiting: string | null;
  lastAcknowledged: string | null;
  batchesApplied: number;
  batchesRefused: number;
  lastRefusal: string | null;
}

export function transportSummary(facilityId: number): TransportSummary {
  const waiting = pendingPush().sort(compareOps);
  const count = (action: string) =>
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND facility_id = ?`,
      action,
      facilityId,
    )?.n ?? 0;

  const lastRefusal = all<{ detail: string }>(
    `SELECT detail FROM audit_log WHERE action = 'sync_batch_refused' AND facility_id = ?
      ORDER BY id DESC LIMIT 1`,
    facilityId,
  )[0];

  return {
    waiting: waiting.length,
    oldestWaiting: waiting[0]?.at ?? null,
    lastAcknowledged:
      get<{ at: string }>(
        `SELECT at FROM audit_log WHERE action = 'sync_batch_acknowledged' AND facility_id = ?
          ORDER BY id DESC LIMIT 1`,
        facilityId,
      )?.at ?? null,
    batchesApplied: count("sync_batch_applied"),
    batchesRefused: count("sync_batch_refused"),
    lastRefusal: lastRefusal ? (JSON.parse(lastRefusal.detail || "{}").why ?? null) : null,
  };
}

// ------------------------------------------------------------- batch folder

/**
 * Where batches are written and looked for.
 *
 * ONE FOLDER, NOT A PATH SOMEBODY TYPES. A screen that takes a filesystem path
 * from a form is a screen that can be asked to read anything the server user
 * can read, and the operator gains nothing from the freedom: they plug a stick
 * in, and the deployment points AFYA_SYNC_DIR at wherever it mounts.
 */
export function batchFolder(): string {
  return process.env.AFYA_SYNC_DIR ?? join(process.cwd(), "data", "sync");
}

/**
 * A plain file name and nothing else.
 *
 * Checked as a name rather than by resolving it and looking at where it landed,
 * because a name that has to be resolved before it looks safe is one nobody
 * should have sent in the first place.
 */
const BATCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

export function batchPath(name: string): string {
  if (!BATCH_NAME.test(name) || name.includes("..")) {
    throw new TransportError(`${name} is not a batch file name`);
  }
  return join(batchFolder(), name);
}

/**
 * The name this device's outgoing batch is written under.
 *
 * TIMESTAMPED, SO A NEW BATCH NEVER OVERWRITES AN OLDER ONE. One file per
 * device would be tidier and would lose data: packing marks those operations
 * pushed, so a second write over a stick that had not been delivered yet
 * destroys the only copy of the first. A folder that accumulates is somebody
 * deleting files they have delivered; a folder that overwrites is a morning's
 * work gone with nothing to recover it from.
 */
export function outboundName(deviceCode: string, at = now()): string {
  // To the millisecond, not the second: two batches written inside one second
  // would share a name, and "never overwrites" with a caveat is not a rule.
  return `${outboundPrefix(deviceCode)}${at.replace(/[-:]/g, "").slice(0, 19)}.json`;
}

/** What every batch this device has written begins with. */
export function outboundPrefix(deviceCode: string): string {
  return `outbound-${deviceCode.toUpperCase().replace(/[^A-Z0-9]/g, "")}-`;
}

export interface BatchFile {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  /** Read out of the file itself. Null where it is not a batch at all. */
  from: string | null;
  ops: number | null;
  sentAt: string | null;
  digest: string | null;
  /** Why it could not be described, where it could not be. */
  problem: string | null;
}

/**
 * What is sitting in the folder.
 *
 * Every file is described, including the ones that cannot be read. A batch that
 * will not parse is the single most useful thing on this screen — it is a stick
 * that has gone bad — and leaving it out shows an empty list to somebody
 * holding a full stick.
 */
export function listBatches(): BatchFile[] {
  let names: string[];
  try {
    names = readdirSync(batchFolder());
  } catch {
    // No folder yet is "nothing to collect", not a failure: a facility that has
    // never synced has never made one.
    return [];
  }

  return names
    .filter((name) => BATCH_NAME.test(name))
    // Newest first: batch names carry the moment they were packed, so this is
    // chronological, and the one somebody just wrote is the one they are
    // looking for.
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((name): BatchFile => {
      const path = join(batchFolder(), name);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        // Somebody pulled the stick out between reading the folder and reading
        // the file. Not a reason to fail the whole screen.
        return { name, sizeBytes: 0, modifiedAt: "", from: null, ops: null, sentAt: null, digest: null,
                 problem: "that file is no longer there" };
      }
      const base = {
        name,
        sizeBytes: stat.size,
        modifiedAt: new Date(stat.mtimeMs).toISOString(),
        from: null,
        ops: null,
        sentAt: null,
        digest: null,
        problem: null as string | null,
      };
      // Described from its size alone rather than read into memory. A batch at
      // the op ceiling is a few megabytes; anything at this size is not one,
      // and a folder is not a place to be trusting about what is in it.
      if (stat.size > MAX_BATCH_BYTES) {
        return { ...base, problem: `that file is ${Math.round(stat.size / 1_048_576)} MB, too large to be a batch` };
      }
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as Envelope;
        if (typeof parsed?.version !== "number" || !Array.isArray(parsed.ops)) {
          return { ...base, problem: "that file is not a batch" };
        }
        return {
          ...base,
          from: parsed.from ?? null,
          ops: parsed.ops.length,
          sentAt: parsed.sentAt ?? null,
          digest: parsed.digest ?? null,
        };
      } catch {
        return { ...base, problem: "that file could not be read" };
      }
    });
}

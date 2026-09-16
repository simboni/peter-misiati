/**
 * M31 Analyser Interface — ASTM and HL7 v2, and the rules that keep a machine
 * from filing a result against the wrong person.
 *
 * A laboratory analyser is the only device in a clinic that produces clinical
 * facts on its own. Typing its numbers in by hand is slow and wrong about one
 * time in fifty; wiring it up badly is wrong in ways nobody notices. So:
 *
 *  THE RAW MESSAGE IS KEPT VERBATIM. When a result is disputed six months
 *  later the question is what the machine actually said, and a parsed row
 *  cannot answer it. Every frame is stored exactly as it arrived.
 *
 *  A RESULT FOR A SPECIMEN NOBODY ORDERED IS HELD, NEVER FILED AND NEVER
 *  DISCARDED. It is somebody's blood. The commonest cause is a barcode typed
 *  wrong at the bench, which a person fixes in ten seconds if they are told
 *  and never fixes if the message is silently dropped.
 *
 *  A UNIT THAT DOES NOT MATCH IS AN EXCEPTION, NOT A NUMBER. An analyser
 *  reporting glucose in mg/dL into a system expecting mmol/L turns 5.5 into
 *  99, and every alert, range and panic threshold downstream is then wrong.
 *  Conversion happens only where a factor has been written down on purpose.
 *
 *  NOTHING THE MACHINE SENDS IS RELEASED. It arrives preliminary and a
 *  licensed technologist turns it into a result, exactly as if it had been
 *  typed. An interface that auto-releases has removed the only person the
 *  KMLTTB registers for the purpose.
 *
 *  A CONTROL IS NOT A PATIENT. Quality control readings go to their own table.
 *  A QC sample filed against a patient is a fabricated result in somebody's
 *  record, and it is an easy mistake for an interface to make.
 *
 *  A RE-RUN SUPERSEDES; IT DOES NOT OVERWRITE. Both readings stand, which is
 *  what lets somebody ask why the machine was asked twice.
 *
 * ⚠️ No serial port is opened and no TCP listener is bound from here. What this
 * module owns is the part that is worth getting right and can be tested: the
 * frame checking, the parsing, the mapping, and the rules above. The transport
 * is a driver that has not been written, and which analyser a laboratory buys
 * decides what it has to do.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { enterResult, toMilli, formatValue, rangeFor } from "./laboratory.ts";
import { getOrder, pendingOrders } from "./orders.ts";
import { notify } from "./notifications.ts";

export class AnalyserError extends Error {}

export type Protocol = "astm" | "hl7";
export type AnalyserMode = "demo" | "live";

export interface Analyser {
  code: string;
  facility_id: number;
  name: string;
  make: string;
  model: string;
  protocol: Protocol;
  connection: string;
  asset_id: string | null;
  mode: AnalyserMode;
  active: number;
  last_seen_at: string | null;
}

// ------------------------------------------------------------- registration

export function registerAnalyser(input: {
  facilityId: number;
  code: string;
  name: string;
  protocol: Protocol;
  make?: string;
  model?: string;
  connection?: string;
  assetId?: string;
  mode?: AnalyserMode;
  byUserId?: number | null;
  byUserName?: string;
}): void {
  const code = input.code.trim().toUpperCase();
  if (!input.name.trim()) throw new AnalyserError("an analyser needs a name");

  run(
    `INSERT INTO analysers
       (code, facility_id, name, make, model, protocol, connection, asset_id, mode, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(code) DO UPDATE SET
       name = excluded.name, make = excluded.make, model = excluded.model,
       protocol = excluded.protocol, connection = excluded.connection,
       asset_id = excluded.asset_id, mode = excluded.mode`,
    code,
    input.facilityId,
    input.name.trim(),
    input.make?.trim() ?? "",
    input.model?.trim() ?? "",
    input.protocol,
    input.connection?.trim() ?? "",
    input.assetId ?? null,
    input.mode ?? "demo",
    now(),
  );

  audit({
    action: "analyser_registered",
    entity: "analyser",
    entityId: code,
    facilityId: input.facilityId,
    actorId: input.byUserId ?? null,
    actorName: input.byUserName ?? "system",
    purpose: "administration",
    detail: { name: input.name, protocol: input.protocol, mode: input.mode ?? "demo" },
  });
}

export function getAnalyser(code: string): Analyser | undefined {
  return get<Analyser>(`SELECT * FROM analysers WHERE code = ?`, code.trim().toUpperCase());
}

export function listAnalysers(facilityId: number): Analyser[] {
  return all<Analyser>(
    `SELECT * FROM analysers WHERE facility_id = ? AND active = 1 ORDER BY code`,
    facilityId,
  );
}

/**
 * Map what the machine calls a test to what this system calls it.
 *
 * `factor` is what the machine's number is multiplied by to reach our unit.
 * Leaving it out means no conversion is known, and results in that unit are
 * held rather than guessed at.
 */
export function mapTest(input: {
  analyserCode: string;
  theirCode: string;
  analyte: string;
  theirUnit?: string;
  factor?: number;
}): void {
  const analyser = getAnalyser(input.analyserCode);
  if (!analyser) throw new AnalyserError("no such analyser");
  if (input.factor !== undefined && !(input.factor > 0)) {
    throw new AnalyserError("a conversion factor is a positive number, or nothing at all");
  }

  run(
    `INSERT INTO analyser_tests (analyser_code, their_code, analyte, their_unit, factor, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(analyser_code, their_code) WHERE active = 1
     DO UPDATE SET analyte = excluded.analyte, their_unit = excluded.their_unit, factor = excluded.factor`,
    analyser.code,
    input.theirCode.trim().toUpperCase(),
    input.analyte.trim().toUpperCase(),
    input.theirUnit?.trim() ?? "",
    input.factor ?? null,
    now(),
  );
}

export function mappingsFor(analyserCode: string) {
  return all<{ id: number; their_code: string; analyte: string; their_unit: string; factor: number | null }>(
    `SELECT * FROM analyser_tests WHERE analyser_code = ? AND active = 1 ORDER BY their_code`,
    analyserCode.trim().toUpperCase(),
  );
}

// ------------------------------------------------------------------- frames

/**
 * ASTM E1381 frame checking.
 *
 * A frame is <STX> fn text <ETX> C1 C2 <CR><LF>, and the checksum is the sum of
 * every byte after STX up to and including ETX, modulo 256, in uppercase hex. A
 * frame that fails is not silently dropped: it is recorded as rejected, because
 * a laboratory losing one result in a hundred and not knowing is worse than one
 * that loses none and would have been told.
 */
export function checkFrame(frame: string): { ok: boolean; text: string; reason?: string } {
  const stx = frame.indexOf("\x02");
  const etx = frame.indexOf("\x03");
  if (stx === -1 || etx === -1 || etx < stx) {
    // Not framed at all. Plenty of drivers hand over bare records, so this is
    // not an error — there is simply nothing to check.
    return { ok: true, text: frame };
  }

  const body = frame.slice(stx + 1, etx + 1);
  const given = frame.slice(etx + 1, etx + 3).toUpperCase();
  let sum = 0;
  for (const ch of body) sum = (sum + ch.charCodeAt(0)) % 256;
  const expected = sum.toString(16).toUpperCase().padStart(2, "0");

  if (given !== expected) {
    return { ok: false, text: "", reason: `checksum ${given} does not match ${expected}` };
  }
  // Drop the leading frame number and the trailing ETX.
  return { ok: true, text: body.slice(1, -1) };
}

/** The checksum a frame should carry, for the outbound side. */
export function frame(text: string, sequence = 1): string {
  const body = `${sequence}${text}\x03`;
  let sum = 0;
  for (const ch of body) sum = (sum + ch.charCodeAt(0)) % 256;
  return `\x02${body}${sum.toString(16).toUpperCase().padStart(2, "0")}\r\n`;
}

// ------------------------------------------------------------------ parsing

export interface ParsedResult {
  specimenRef: string;
  theirCode: string;
  value: string;
  unit: string;
  /** Set when the machine flags it as a control rather than a patient sample. */
  control: boolean;
  at: string;
}

export interface Parsed {
  results: ParsedResult[];
  /** What the message could not be made sense of. */
  problems: string[];
}

/**
 * ASTM E1394 records.
 *
 * H header, P patient, O order, R result, C comment, L terminator. Fields are
 * pipe-separated and components caret-separated. Only what is used is read;
 * what is not understood is left alone rather than guessed at.
 */
export function parseAstm(raw: string): Parsed {
  const results: ParsedResult[] = [];
  const problems: string[] = [];
  let specimenRef = "";
  let control = false;

  for (const line of raw.split(/\r\n|\r|\n/)) {
    const checked = checkFrame(line);
    if (!checked.ok) {
      problems.push(`frame rejected: ${checked.reason}`);
      continue;
    }
    const text = checked.text.trim();
    if (!text) continue;

    const fields = text.split("|");
    const type = fields[0]?.replace(/^\d+/, "").toUpperCase();

    if (type === "P") {
      // Practice-assigned patient id. Many analysers put the specimen barcode
      // here and nothing else, which is why the order record is preferred.
      control = /^(qc|control)/i.test(fields[3] ?? "");
    } else if (type === "O") {
      // O|1|SPECIMEN|...|^^^TEST\^^^TEST2|...
      specimenRef = (fields[2] ?? "").split("^")[0].trim();
      if (/^(qc|control)/i.test(specimenRef)) control = true;
    } else if (type === "R") {
      // R|1|^^^GLU|5.5|mmol/L|...|N||F||...|20260916103000
      const theirCode = (fields[2] ?? "").split("^").filter(Boolean).pop()?.trim() ?? "";
      const value = (fields[3] ?? "").trim();
      const unit = (fields[4] ?? "").trim();
      const stamp = (fields[12] ?? "").trim();
      if (!theirCode) {
        problems.push("a result record with no test code");
        continue;
      }
      results.push({ specimenRef, theirCode, value, unit, control, at: astmTime(stamp) });
    }
  }

  return { results, problems };
}

/** HL7 v2 ORU^R01: MSH, PID, OBR, OBX. */
export function parseHl7(raw: string): Parsed {
  const results: ParsedResult[] = [];
  const problems: string[] = [];
  let specimenRef = "";
  let control = false;

  for (const line of raw.split(/\r\n|\r|\n/)) {
    const text = line.trim();
    if (!text) continue;
    const fields = text.split("|");
    const type = fields[0]?.toUpperCase();

    if (type === "PID") {
      control = /^(qc|control)/i.test(fields[3] ?? "");
    } else if (type === "OBR") {
      // OBR|1|placer|filler|...  — the filler order number is the barcode on
      // the tube for most analysers.
      specimenRef = ((fields[3] || fields[2]) ?? "").split("^")[0].trim();
      if (/^(qc|control)/i.test(specimenRef)) control = true;
    } else if (type === "OBX") {
      // OBX|1|NM|GLU^Glucose||5.5|mmol/L|...
      const theirCode = (fields[3] ?? "").split("^")[0].trim();
      const value = (fields[5] ?? "").trim();
      const unit = (fields[6] ?? "").trim();
      const stamp = (fields[14] ?? "").trim();
      if (!theirCode) {
        problems.push("an OBX with no observation identifier");
        continue;
      }
      results.push({ specimenRef, theirCode, value, unit, control, at: astmTime(stamp) });
    }
  }

  return { results, problems };
}

/** YYYYMMDDHHMMSS, which both protocols use, to an ISO stamp. */
function astmTime(stamp: string): string {
  const digits = stamp.replace(/\D/g, "");
  if (digits.length < 8) return now();
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${
    digits.slice(8, 10) || "00"
  }:${digits.slice(10, 12) || "00"}:${digits.slice(12, 14) || "00"}.000Z`;
  return Number.isNaN(Date.parse(iso)) ? now() : iso;
}

// ------------------------------------------------------------------ inbound

export interface Received {
  messageId: string;
  filed: number;
  held: number;
  qc: number;
  status: "accepted" | "held" | "rejected";
  problems: string[];
}

/**
 * Take a message off an analyser.
 *
 * Everything is stored before anything is decided, and the raw text is never
 * touched. What cannot be filed is held with a reason rather than dropped.
 */
export function receiveMessage(input: {
  analyserCode: string;
  raw: string;
  receivedAt?: string;
  byUserId?: number | null;
  byUserName?: string;
  deviceCode?: string;
}): Received {
  const analyser = getAnalyser(input.analyserCode);
  if (!analyser) throw new AnalyserError("no such analyser");
  if (!input.raw.trim()) throw new AnalyserError("that message is empty");

  const messageId = mintLocalId(input.deviceCode ?? analyser.code.slice(0, 4), 8);
  const receivedAt = input.receivedAt ?? now();
  const parsed = analyser.protocol === "astm" ? parseAstm(input.raw) : parseHl7(input.raw);

  let filed = 0;
  let held = 0;
  let qc = 0;
  const problems = [...parsed.problems];

  return tx(() => {
    run(
      `INSERT INTO analyser_messages
         (id, analyser_code, direction, raw, status, note, results, held, received_at, created_at)
       VALUES (?, ?, 'in', ?, 'held', '', 0, 0, ?, ?)`,
      messageId,
      analyser.code,
      input.raw,
      receivedAt,
      now(),
    );
    run(`UPDATE analysers SET last_seen_at = ? WHERE code = ?`, receivedAt, analyser.code);

    for (const result of parsed.results) {
      // A control is not a patient, and this is the branch that keeps it that
      // way. Everything below this line assumes a patient sample.
      if (result.control) {
        fileQc(analyser.code, messageId, result);
        qc++;
        continue;
      }

      const outcome = fileResult(analyser, messageId, result, input.byUserId ?? null);
      if (outcome.filed) filed++;
      else {
        held++;
        problems.push(outcome.reason!);
      }
    }

    const status = parsed.problems.some((p) => p.startsWith("frame rejected"))
      ? "rejected"
      : held > 0
        ? "held"
        : "accepted";

    run(
      `UPDATE analyser_messages SET status = ?, note = ?, results = ?, held = ? WHERE id = ?`,
      status,
      problems.slice(0, 5).join("; "),
      filed,
      held,
      messageId,
    );

    if (held > 0) {
      notify({
        facilityId: analyser.facility_id,
        ownerRole: "lab_technologist",
        severity: "warning",
        kind: "analyser_held",
        subject: `${analyser.name}: ${held} reading${held === 1 ? "" : "s"} could not be filed`,
        body: problems.slice(0, 3).join("; ") || "See the analyser exceptions.",
        entity: "analyser",
        entityId: analyser.code,
        dedupeKey: `analyser_held:${messageId}`,
      });
    }

    audit({
      action: "analyser_message",
      entity: "analyser",
      entityId: analyser.code,
      facilityId: analyser.facility_id,
      actorId: input.byUserId ?? null,
      actorName: input.byUserName ?? analyser.code,
      purpose: "treatment",
      deviceCode: input.deviceCode ?? null,
      detail: { messageId, protocol: analyser.protocol, filed, held, qc, status, mode: analyser.mode },
    });

    return { messageId, filed, held, qc, status, problems };
  });
}

function hold(
  analyserCode: string,
  messageId: string,
  result: ParsedResult,
  analyte: string,
  reason: string,
): { filed: false; reason: string } {
  run(
    `INSERT INTO analyser_exceptions
       (message_id, analyser_code, specimen_ref, their_code, analyte, value_text, unit, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    messageId,
    analyserCode,
    result.specimenRef,
    result.theirCode,
    analyte,
    result.value,
    result.unit,
    reason,
    now(),
  );
  return { filed: false, reason };
}

function fileResult(
  analyser: Analyser,
  messageId: string,
  result: ParsedResult,
  byUserId: number | null,
): { filed: boolean; reason?: string } {
  const mapping = mappingsFor(analyser.code).find((m) => m.their_code === result.theirCode.toUpperCase());
  if (!mapping) {
    return hold(
      analyser.code,
      messageId,
      result,
      "",
      `${analyser.name} reports a test called "${result.theirCode}" that is not mapped to anything here`,
    );
  }

  if (!result.specimenRef) {
    return hold(analyser.code, messageId, result, mapping.analyte, "the message carries no specimen barcode");
  }

  const specimen = get<{ id: string; order_id: string; rejected_at: string | null }>(
    `SELECT id, order_id, rejected_at FROM specimens WHERE id = ?`,
    result.specimenRef,
  );
  if (!specimen) {
    // Not discarded. It is somebody's blood, and the usual cause is a barcode
    // typed wrong at the bench.
    return hold(
      analyser.code,
      messageId,
      result,
      mapping.analyte,
      `no specimen ${result.specimenRef} on this system — check the barcode at the bench`,
    );
  }
  if (specimen.rejected_at) {
    return hold(
      analyser.code,
      messageId,
      result,
      mapping.analyte,
      `specimen ${specimen.id} was rejected — a result on it cannot be reported`,
    );
  }

  // Units. An analyser reporting glucose in mg/dL into a system expecting
  // mmol/L turns 5.5 into 99, and every threshold downstream is then wrong.
  const order = getOrder(specimen.order_id);
  const expected = order ? rangeFor(mapping.analyte, order.patient_mrn)?.unit ?? "" : "";
  const reported = result.unit || mapping.their_unit;
  let factor = 1;

  if (expected && reported && !sameUnit(expected, reported)) {
    if (mapping.factor === null) {
      return hold(
        analyser.code,
        messageId,
        result,
        mapping.analyte,
        `${analyser.name} reports ${mapping.analyte} in ${reported} and this system expects ${expected}, and no conversion has been written down`,
      );
    }
    factor = mapping.factor;
  } else if (mapping.factor !== null && mapping.factor !== 1 && sameUnit(mapping.their_unit, reported)) {
    factor = mapping.factor;
  }

  const numeric = Number(result.value.replace(/^[<>=]+/, "").trim());
  const quantitative = result.value !== "" && Number.isFinite(numeric);

  try {
    enterResult({
      orderId: specimen.order_id,
      analyte: mapping.analyte,
      value: quantitative ? numeric * factor : undefined,
      valueText: quantitative ? undefined : result.value,
      unit: expected || reported,
      // A machine is not a user. Inventing one would put a name on a reading
      // nobody typed.
      enteredBy: byUserId,
      enteredByName: `${analyser.code}${analyser.mode === "demo" ? " (demo)" : ""}`,
      deviceCode: analyser.code.slice(0, 4),
      // Never released. A licensed technologist turns this into a result.
      preliminary: true,
    });
    return { filed: true };
  } catch (error) {
    return hold(
      analyser.code,
      messageId,
      result,
      mapping.analyte,
      error instanceof Error ? error.message : "the reading could not be filed",
    );
  }
}

/** "mmol/L" and "MMOL/L" and "mmol/l" are the same unit. Nothing cleverer. */
function sameUnit(a: string, b: string): boolean {
  return a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();
}

function fileQc(analyserCode: string, messageId: string, result: ParsedResult): void {
  const numeric = Number(result.value);
  run(
    `INSERT INTO analyser_qc
       (analyser_code, message_id, control_ref, analyte, value_milli, unit, run_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    analyserCode,
    messageId,
    result.specimenRef || "control",
    result.theirCode.toUpperCase(),
    Number.isFinite(numeric) ? toMilli(numeric) : null,
    result.unit,
    result.at,
    now(),
  );
}

// ---------------------------------------------------------------- exceptions

export interface HeldReading {
  id: number;
  analyser_code: string;
  specimen_ref: string;
  their_code: string;
  analyte: string;
  value_text: string;
  unit: string;
  reason: string;
  created_at: string;
  message_id: string;
}

export function heldReadings(facilityId: number): HeldReading[] {
  return all<HeldReading>(
    `SELECT x.* FROM analyser_exceptions x JOIN analysers a ON a.code = x.analyser_code
      WHERE a.facility_id = ? AND x.resolved_at IS NULL
      ORDER BY x.created_at DESC`,
    facilityId,
  );
}

/**
 * File a held reading against the specimen it actually belonged to.
 *
 * The exception stays on the record with what it was resolved to, because the
 * pattern — one bench, one shift, the same mistake — is what tells a laboratory
 * manager something is wrong with the process rather than the machine.
 */
export function resolveHeld(input: {
  exceptionId: number;
  specimenId?: string;
  discardReason?: string;
  byUserId: number | null;
  byUserName: string;
}): { filed: boolean } {
  const held = get<HeldReading & { resolved_at: string | null }>(
    `SELECT * FROM analyser_exceptions WHERE id = ?`,
    input.exceptionId,
  );
  if (!held) throw new AnalyserError("no such held reading");
  if (held.resolved_at) throw new AnalyserError("that reading has already been dealt with");
  if (!input.specimenId && !input.discardReason?.trim()) {
    throw new AnalyserError("either say which specimen it belongs to, or say why it is being discarded");
  }

  const analyser = getAnalyser(held.analyser_code)!;

  return tx(() => {
    let filed = false;
    let resolution = input.discardReason?.trim() ?? "";

    if (input.specimenId) {
      const specimen = get<{ id: string; order_id: string }>(
        `SELECT id, order_id FROM specimens WHERE id = ?`,
        input.specimenId,
      );
      if (!specimen) throw new AnalyserError("no such specimen");

      const numeric = Number(held.value_text.replace(/^[<>=]+/, "").trim());
      enterResult({
        orderId: specimen.order_id,
        analyte: held.analyte || held.their_code,
        value: Number.isFinite(numeric) ? numeric : undefined,
        valueText: Number.isFinite(numeric) ? undefined : held.value_text,
        unit: held.unit,
        enteredBy: input.byUserId,
        enteredByName: `${analyser.code} (filed by ${input.byUserName})`,
        deviceCode: analyser.code.slice(0, 4),
        preliminary: true,
      });
      filed = true;
      resolution = `Filed against ${specimen.id}`;
    }

    run(
      `UPDATE analyser_exceptions SET resolved_at = ?, resolution = ?, resolved_by = ?, resolver_name = ? WHERE id = ?`,
      now(),
      resolution,
      input.byUserId,
      input.byUserName,
      held.id,
    );

    audit({
      action: filed ? "analyser_reading_filed" : "analyser_reading_discarded",
      entity: "analyser",
      entityId: analyser.code,
      facilityId: analyser.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: {
        exceptionId: held.id,
        specimenRef: held.specimen_ref,
        analyte: held.analyte,
        value: held.value_text,
        resolution,
      },
    });

    return { filed };
  });
}

// ----------------------------------------------------------------- worklist

export interface WorklistEntry {
  specimenId: string;
  patientMrn: string;
  /** What was ordered, as a service code. */
  serviceCode: string;
  serviceName: string;
  collectedAt: string;
  priority: string;
}

/**
 * What the analyser should be asked to run.
 *
 * The bidirectional half: an analyser that can query gets told which tests this
 * tube is for, which is what stops a laboratory running a full panel on every
 * sample because nobody could remember what was ordered.
 */
export function worklist(facilityId: number): WorklistEntry[] {
  return pendingOrders("lab")
    .flatMap((order) => {
      const specimens = all<{ id: string; collected_at: string; rejected_at: string | null }>(
        `SELECT id, collected_at, rejected_at FROM specimens WHERE order_id = ?`,
        order.id,
      ).filter((s) => !s.rejected_at);

      return specimens.map((specimen) => ({
        specimenId: specimen.id,
        patientMrn: order.patient_mrn,
        // What was ordered, not what will be measured. A CBC is one order and
        // several analytes, and which analytes a panel expands to is the
        // analyser's own configuration rather than something this system
        // should be guessing at.
        serviceCode: order.service_code,
        serviceName: order.service_name ?? order.service_code,
        collectedAt: specimen.collected_at,
        priority: order.priority,
      }));
    })
    .sort((a, b) =>
      a.priority === "stat" && b.priority !== "stat" ? -1
      : b.priority === "stat" && a.priority !== "stat" ? 1
      : a.collectedAt.localeCompare(b.collectedAt),
    );
}

/**
 * The worklist as an ASTM query response, for a driver to put on the wire.
 *
 * Built here rather than in a driver so the record layout is testable without
 * a machine on the other end.
 */
export function worklistAstm(facilityId: number, analyserCode: string): string {
  const stamp = now().replace(/\D/g, "").slice(0, 14);
  const lines = [`H|\\^&|||Afya Core|||||${analyserCode}||P|1|${stamp}`];
  let n = 1;
  for (const entry of worklist(facilityId)) {
    lines.push(`P|${n}|||${entry.patientMrn}`);
    lines.push(
      `O|${n}|${entry.specimenId}||^^^${entry.serviceCode}|${
        entry.priority === "stat" ? "S" : "R"
      }|${entry.collectedAt.replace(/\D/g, "").slice(0, 14)}||||||||||||||||||O`,
    );
    n++;
  }
  lines.push(`L|1|N`);
  return lines.map((line, index) => frame(line, index + 1)).join("");
}

// ------------------------------------------------------------------ reports

export function messagesFor(analyserCode: string, limit = 30) {
  return all<{
    id: string;
    direction: string;
    raw: string;
    status: string;
    note: string;
    results: number;
    held: number;
    received_at: string;
  }>(
    `SELECT * FROM analyser_messages WHERE analyser_code = ? ORDER BY received_at DESC LIMIT ?`,
    analyserCode.trim().toUpperCase(),
    limit,
  );
}

export function qcFor(analyserCode: string, limit = 30) {
  return all<{
    id: number;
    control_ref: string;
    analyte: string;
    value_milli: number | null;
    unit: string;
    in_range: number | null;
    run_at: string;
  }>(
    `SELECT * FROM analyser_qc WHERE analyser_code = ? ORDER BY run_at DESC LIMIT ?`,
    analyserCode.trim().toUpperCase(),
    limit,
  );
}

export interface AnalyserSummary {
  analysers: number;
  live: number;
  messages: number;
  filed: number;
  held: number;
  rejectedFrames: number;
  qcRuns: number;
  /** Analysers that have not said anything for a day. */
  silent: { code: string; name: string; lastSeenAt: string | null }[];
  /** The commonest reason readings are held, which is usually the fix. */
  topReason: string | null;
}

export function analyserSummary(facilityId: number, sinceDays = 30, asOf = today()): AnalyserSummary {
  const since = new Date(Date.parse(`${asOf}T00:00:00.000Z`) - sinceDays * 86_400_000).toISOString();
  const analysers = listAnalysers(facilityId);

  const messages = all<{ status: string; results: number; held: number }>(
    `SELECT m.status, m.results, m.held FROM analyser_messages m JOIN analysers a ON a.code = m.analyser_code
      WHERE a.facility_id = ? AND m.received_at >= ? AND m.direction = 'in'`,
    facilityId,
    since,
  );

  const held = heldReadings(facilityId);
  const reasons = new Map<string, number>();
  for (const row of held) {
    // Group on the shape of the reason rather than its detail, so "no specimen
    // X" and "no specimen Y" count as the same problem.
    const key = row.reason.replace(/\b[A-Z0-9-]{6,}\b/g, "…");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  const dayAgo = new Date(Date.parse(`${asOf}T00:00:00.000Z`) - 86_400_000).toISOString();

  return {
    analysers: analysers.length,
    live: analysers.filter((a) => a.mode === "live").length,
    messages: messages.length,
    filed: messages.reduce((sum, m) => sum + m.results, 0),
    held: held.length,
    rejectedFrames: messages.filter((m) => m.status === "rejected").length,
    qcRuns:
      get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM analyser_qc q JOIN analysers a ON a.code = q.analyser_code
          WHERE a.facility_id = ? AND q.run_at >= ?`,
        facilityId,
        since,
      )?.n ?? 0,
    silent: analysers
      .filter((a) => !a.last_seen_at || a.last_seen_at < dayAgo)
      .map((a) => ({ code: a.code, name: a.name, lastSeenAt: a.last_seen_at })),
    topReason: [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

/**
 * A message the demonstration analyser would send.
 *
 * ⚠️ Generated, not captured from a machine. Real analysers deviate from both
 * standards in small ways and the first week of any installation is spent
 * finding out how.
 */
export function simulateAstm(input: {
  specimenId: string;
  readings: { code: string; value: string; unit: string }[];
  at?: string;
  control?: boolean;
}): string {
  const stamp = (input.at ?? now()).replace(/\D/g, "").slice(0, 14);
  const lines = [
    `H|\\^&|||DemoAnalyser^1.0|||||||P|1|${stamp}`,
    `P|1|||${input.control ? "QC" : input.specimenId}`,
    `O|1|${input.specimenId}||${input.readings.map((r) => `^^^${r.code}`).join("\\")}|R|${stamp}`,
    ...input.readings.map(
      (r, index) => `R|${index + 1}|^^^${r.code}|${r.value}|${r.unit}||N||F||||${stamp}`,
    ),
    `L|1|N`,
  ];
  return lines.map((line, index) => frame(line, index + 1)).join("");
}

/**
 * ⚠️ One analyser, in demo mode, with the mappings a small chemistry and
 * haematology bench would need. The codes are the demonstration machine's, not
 * any real vendor's.
 */
export function seedAnalysers(facilityId: number, assetId?: string): void {
  registerAnalyser({
    facilityId,
    code: "CHEM1",
    name: "Chemistry analyser",
    protocol: "astm",
    connection: "RS-232, bench 2 (no driver written)",
    assetId,
    mode: "demo",
    byUserName: "seed",
  });
  registerAnalyser({
    facilityId,
    code: "HAEM1",
    name: "Haematology analyser",
    protocol: "hl7",
    connection: "TCP 5150 (no listener bound)",
    mode: "demo",
    byUserName: "seed",
  });

  // Same unit as the reference ranges, so nothing converts.
  mapTest({ analyserCode: "CHEM1", theirCode: "GLU", analyte: "GLUCOSE", theirUnit: "mmol/L", factor: 1 });
  mapTest({ analyserCode: "CHEM1", theirCode: "K", analyte: "K", theirUnit: "mmol/L", factor: 1 });
  mapTest({ analyserCode: "CHEM1", theirCode: "NA", analyte: "NA", theirUnit: "mmol/L", factor: 1 });
  // Deliberately without a factor: this machine reports creatinine in mg/dL
  // and the ranges are in µmol/L, so its results are held until somebody
  // writes the conversion down on purpose.
  mapTest({ analyserCode: "CHEM1", theirCode: "CREA", analyte: "CREATININE", theirUnit: "mg/dL" });

  mapTest({ analyserCode: "HAEM1", theirCode: "HGB", analyte: "HB", theirUnit: "g/dL", factor: 1 });
  mapTest({ analyserCode: "HAEM1", theirCode: "WBC", analyte: "WBC", theirUnit: "x10^9/L", factor: 1 });
  mapTest({ analyserCode: "HAEM1", theirCode: "PLT", analyte: "PLT", theirUnit: "x10^9/L", factor: 1 });
}

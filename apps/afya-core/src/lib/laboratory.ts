/**
 * M30 Laboratory (LIS) — specimens, results, and the two things that make a
 * laboratory safe rather than merely productive.
 *
 * A READING IS NOT A RESULT. A number entered by whoever ran the analyser is a
 * reading. It becomes a result when a licensed technologist releases it, and
 * only a released result reaches the clinician, the patient's record or a
 * claim. This is the KMLTTB requirement and it is also just true.
 *
 * A PANIC VALUE IS A PHONE CALL. A potassium of 7.1 does not belong at the
 * bottom of a worklist. Releasing one raises a critical notification against
 * the ordering clinician's desk in the same transaction, so "nobody saw it" is
 * not available as an outcome.
 *
 * Two smaller decisions that matter:
 *
 *   VALUES ARE INTEGERS IN THOUSANDTHS. 11.2 g/dL is 11200. Binary floating
 *   point has no business anywhere near a clinical decision, and a haemoglobin
 *   that reads 11.199999999 on one screen is a support call.
 *
 *   A CORRECTED RESULT SUPERSEDES, IT DOES NOT OVERWRITE. Somebody acted on the
 *   first one. The old value stays readable with the reason it changed.
 *
 * Releasing a result also attaches the report to the encounter, which is what
 * clears the claim scrubber's documentation gate — the lab report a payer asks
 * for is the one the laboratory actually produced, not a tick box.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { check, explain, licenceStatus } from "./access.ts";
import { resolvePatient } from "./patients.ts";
import { getOrder, setOrderStatus, type Order } from "./orders.ts";
import { notify } from "./notifications.ts";
import { attach } from "./documents.ts";
import { getEncounter } from "./encounters.ts";

export class LabError extends Error {}

export type ResultFlag = "normal" | "low" | "high" | "panic_low" | "panic_high" | "abnormal";
export type ResultStatus = "preliminary" | "final" | "corrected" | "superseded";

export interface Specimen {
  id: string;
  order_id: string;
  patient_mrn: string;
  kind: string;
  collected_by: number | null;
  collector_name: string;
  collected_at: string;
  received_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
}

export interface LabResult {
  id: string;
  order_id: string;
  patient_mrn: string;
  analyte: string;
  value_milli: number | null;
  value_text: string;
  unit: string;
  low_milli: number | null;
  high_milli: number | null;
  flag: ResultFlag;
  status: ResultStatus;
  entered_by: number | null;
  entered_by_name: string;
  released_by: number | null;
  releaser_name: string | null;
  releaser_licence: string | null;
  released_at: string | null;
  supersedes: string | null;
  superseded_at: string | null;
  correction_reason: string | null;
  created_at: string;
}

/** 11.2 g/dL is 11200. The only place a decimal becomes an integer. */
export function toMilli(value: number): number {
  return Math.round(value * 1000);
}

/** Back to something a person reads. Never used for comparison or arithmetic. */
export function formatValue(milli: number | null, unit = ""): string {
  if (milli === null) return "";
  const text = (milli / 1000).toFixed(milli % 1000 === 0 ? 0 : milli % 100 === 0 ? 1 : 2);
  return unit ? `${text} ${unit}` : text;
}

// ------------------------------------------------------------------ specimens

/**
 * Record a collection.
 *
 * Moves the order to `collected`, which is what stops a laboratory reporting on
 * something nobody drew.
 */
export function collectSpecimen(input: {
  orderId: string;
  kind: string;
  collectorId: number;
  collectorName: string;
  deviceCode: string;
}): string {
  const order = getOrder(input.orderId);
  if (!order) throw new LabError("no such order");
  if (order.status === "cancelled") throw new LabError("that order was cancelled");
  if (!input.kind.trim()) throw new LabError("a specimen must record what was collected");

  const id = mintLocalId(input.deviceCode, 8);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO specimens (id, order_id, patient_mrn, kind, collected_by, collector_name, collected_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      order.id,
      order.patient_mrn,
      input.kind.trim(),
      input.collectorId,
      input.collectorName,
      at,
      at,
    );
    setOrderStatus({
      orderId: order.id,
      status: "collected",
      byUserId: input.collectorId,
      byUserName: input.collectorName,
    });
    audit({
      action: "specimen_collected",
      entity: "order",
      entityId: order.id,
      patientId: order.patient_mrn,
      actorId: input.collectorId,
      actorName: input.collectorName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { specimenId: id, kind: input.kind },
    });
    return id;
  });
}

/**
 * Reject a specimen.
 *
 * Haemolysed, wrong tube, unlabelled. Saying so today and re-bleeding beats a
 * wrong result tomorrow — and the clinician has to be told, because they are
 * waiting for an answer that is not coming.
 */
export function rejectSpecimen(input: {
  specimenId: string;
  reason: string;
  byUserId: number;
  byUserName: string;
}): void {
  const specimen = get<Specimen>(`SELECT * FROM specimens WHERE id = ?`, input.specimenId);
  if (!specimen) throw new LabError("no such specimen");
  if (specimen.rejected_at) throw new LabError("that specimen has already been rejected");
  if (!input.reason.trim()) throw new LabError("rejecting a specimen must record why");

  const order = getOrder(specimen.order_id)!;
  const encounter = getEncounter(order.encounter_id);

  tx(() => {
    run(
      `UPDATE specimens SET rejected_at = ?, rejection_reason = ? WHERE id = ?`,
      now(),
      input.reason.trim(),
      input.specimenId,
    );
    notify({
      facilityId: encounter?.facility_id ?? 1,
      ownerRole: "clinician",
      severity: "warning",
      kind: "specimen_rejected",
      subject: `${order.service_name} for ${order.patient_mrn} needs re-collecting`,
      body: `The specimen was rejected: ${input.reason.trim()}. No result is coming for this order.`,
      entity: "order",
      entityId: order.id,
      dedupeKey: `specimen_rejected:${input.specimenId}`,
    });
    audit({
      action: "specimen_rejected",
      entity: "order",
      entityId: order.id,
      patientId: order.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { specimenId: input.specimenId, reason: input.reason },
    });
  });
}

export function specimensFor(orderId: string): Specimen[] {
  return all<Specimen>(`SELECT * FROM specimens WHERE order_id = ? ORDER BY collected_at`, orderId);
}

// ------------------------------------------------------------ reference ranges

export function defineRange(input: {
  analyte: string;
  unit: string;
  sex?: "male" | "female" | "";
  minAgeYears?: number;
  maxAgeYears?: number;
  low?: number;
  high?: number;
  panicLow?: number;
  panicHigh?: number;
  source: string;
}): void {
  if (!input.source.trim()) {
    throw new LabError("a reference range must record its source — whose ranges are these?");
  }
  run(
    `INSERT INTO reference_ranges
       (analyte, unit, sex, min_age_years, max_age_years, low_milli, high_milli, panic_low_milli, panic_high_milli, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(analyte, sex, min_age_years, max_age_years) DO UPDATE SET
       unit = excluded.unit, low_milli = excluded.low_milli, high_milli = excluded.high_milli,
       panic_low_milli = excluded.panic_low_milli, panic_high_milli = excluded.panic_high_milli,
       source = excluded.source`,
    input.analyte.trim().toUpperCase(),
    input.unit,
    input.sex ?? "",
    input.minAgeYears ?? 0,
    input.maxAgeYears ?? 200,
    input.low === undefined ? null : toMilli(input.low),
    input.high === undefined ? null : toMilli(input.high),
    input.panicLow === undefined ? null : toMilli(input.panicLow),
    input.panicHigh === undefined ? null : toMilli(input.panicHigh),
    input.source.trim(),
  );
}

export interface Range {
  analyte: string;
  unit: string;
  low_milli: number | null;
  high_milli: number | null;
  panic_low_milli: number | null;
  panic_high_milli: number | null;
  source: string;
}

/**
 * The range that applies to this person, most specific first.
 *
 * A haemoglobin of 10.5 is anaemia in a man, borderline in a woman and normal
 * in a two-year-old. One range for everybody produces flags nobody trusts, and
 * a flag nobody trusts is a flag nobody reads.
 */
export function rangeFor(analyte: string, patientMrn: string): Range | undefined {
  const patient = resolvePatient(patientMrn);
  const sex = patient?.sex ?? "";
  const age = patient?.date_of_birth
    ? Math.floor((Date.now() - Date.parse(patient.date_of_birth)) / (365.25 * 86_400_000))
    : null;

  const candidates = all<Range & { sex: string; min_age_years: number; max_age_years: number }>(
    `SELECT * FROM reference_ranges WHERE analyte = ?`,
    analyte.trim().toUpperCase(),
  );

  const matching = candidates.filter(
    (r) =>
      (r.sex === "" || r.sex === sex) &&
      (age === null || (age >= r.min_age_years && age <= r.max_age_years)),
  );

  // Most specific wins: a sex-specific range beats a general one, and a narrow
  // age band beats a wide one.
  return matching.sort(
    (a, b) =>
      (b.sex === "" ? 0 : 1) - (a.sex === "" ? 0 : 1) ||
      (a.max_age_years - a.min_age_years) - (b.max_age_years - b.min_age_years),
  )[0];
}

function flagFor(valueMilli: number, range: Range | undefined): ResultFlag {
  if (!range) return "normal";
  if (range.panic_low_milli !== null && valueMilli <= range.panic_low_milli) return "panic_low";
  if (range.panic_high_milli !== null && valueMilli >= range.panic_high_milli) return "panic_high";
  if (range.low_milli !== null && valueMilli < range.low_milli) return "low";
  if (range.high_milli !== null && valueMilli > range.high_milli) return "high";
  return "normal";
}

// -------------------------------------------------------------------- results

/**
 * Enter a reading.
 *
 * Not a result yet — nothing here reaches a clinician until it is released.
 * Flagged against the range for this particular patient at the moment it is
 * entered, so the flag reflects what was known then.
 */
export function enterResult(input: {
  orderId: string;
  analyte: string;
  /** A measured number, e.g. 11.2. Omit for a qualitative result. */
  value?: number;
  /** A qualitative result, e.g. "Positive". */
  valueText?: string;
  unit?: string;
  enteredBy: number;
  enteredByName: string;
  deviceCode: string;
  preliminary?: boolean;
}): string {
  const order = getOrder(input.orderId);
  if (!order) throw new LabError("no such order");
  if (order.status === "cancelled") throw new LabError("that order was cancelled");
  if (order.status === "ordered") {
    throw new LabError("no specimen has been collected for this order — a result without one cannot be attributed");
  }

  const rejected = specimensFor(order.id).every((s) => s.rejected_at);
  if (specimensFor(order.id).length > 0 && rejected) {
    throw new LabError("every specimen for this order was rejected — collect another before reporting");
  }

  if (input.value === undefined && !input.valueText?.trim()) {
    throw new LabError("a result must have a value");
  }

  const analyte = input.analyte.trim().toUpperCase();
  const range = rangeFor(analyte, order.patient_mrn);
  const valueMilli = input.value === undefined ? null : toMilli(input.value);
  const flag =
    valueMilli === null
      ? // A qualitative result is abnormal when it is positive or reactive; the
        // laboratory is stating a finding, not measuring against a range.
        /^(positive|reactive|detected|seen)/i.test(input.valueText!.trim())
        ? "abnormal"
        : "normal"
      : flagFor(valueMilli, range);

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO lab_results
         (id, order_id, patient_mrn, analyte, value_milli, value_text, unit, low_milli, high_milli,
          flag, status, entered_by, entered_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      order.id,
      order.patient_mrn,
      analyte,
      valueMilli,
      input.valueText?.trim() ?? "",
      input.unit ?? range?.unit ?? "",
      range?.low_milli ?? null,
      range?.high_milli ?? null,
      flag,
      input.preliminary ? "preliminary" : "final",
      input.enteredBy,
      input.enteredByName,
      now(),
    );

    if (order.status === "collected") {
      setOrderStatus({
        orderId: order.id,
        status: "in_progress",
        byUserId: input.enteredBy,
        byUserName: input.enteredByName,
      });
    }

    return id;
  });
}

/**
 * Release the results on an order.
 *
 * Licence-gated: only a technologist the KMLTTB registers may turn a reading
 * into a result. Everything happens in one transaction — the release, the
 * order's state, the report attached to the encounter, and the telephone call a
 * panic value amounts to — because a released panic value with no notification
 * raised is the exact failure this module exists to prevent.
 */
export function releaseResults(input: {
  orderId: string;
  releaserId: number;
  releaserName: string;
  deviceCode: string;
}): { released: number; panic: string[] } {
  const order = getOrder(input.orderId);
  if (!order) throw new LabError("no such order");

  const decision = check(input.releaserId, "lab.result.release");
  if (!decision.allowed) throw new LabError(explain(decision));

  const pending = all<LabResult>(
    `SELECT * FROM lab_results WHERE order_id = ? AND superseded_at IS NULL AND released_at IS NULL`,
    order.id,
  );
  if (pending.length === 0) throw new LabError("there is nothing waiting to be released on this order");

  const licence = licenceStatus(input.releaserId);
  const at = now();
  const panic: string[] = [];

  return tx(() => {
    for (const result of pending) {
      run(
        `UPDATE lab_results SET released_by = ?, releaser_name = ?, releaser_licence = ?, released_at = ? WHERE id = ?`,
        input.releaserId,
        input.releaserName,
        licence.state === "current" ? (licence.number ?? null) : null,
        at,
        result.id,
      );
      if (result.flag === "panic_low" || result.flag === "panic_high") panic.push(result.analyte);
    }

    setOrderStatus({
      orderId: order.id,
      status: "resulted",
      byUserId: input.releaserId,
      byUserName: input.releaserName,
    });

    // The report, attached to the encounter. This is what the claim scrubber's
    // documentation gate finds when the payer's benefit rule asks for a lab
    // report — the one the laboratory produced, not a tick box.
    const encounter = getEncounter(order.encounter_id);
    attach({
      facilityId: encounter?.facility_id ?? 1,
      entity: "encounter",
      entityId: order.encounter_id,
      patientMrn: order.patient_mrn,
      kind: "lab_report",
      filename: `${order.service_code}-${order.id}.txt`,
      contentType: "text/plain",
      content: Buffer.from(reportText(order, [...pending])),
      deviceCode: input.deviceCode,
      byUserId: input.releaserId,
      byUserName: input.releaserName,
    });

    if (panic.length > 0) {
      // Not a row on a worklist. Somebody is telephoned.
      notify({
        facilityId: encounter?.facility_id ?? 1,
        ownerRole: "clinician",
        severity: "critical",
        kind: "panic_value",
        subject: `CRITICAL result for ${order.patient_mrn}: ${panic.join(", ")}`,
        body: `${order.service_name}. This needs to be seen now, not on the next round.`,
        entity: "order",
        entityId: order.id,
        dedupeKey: `panic:${order.id}`,
      });
    }

    audit({
      action: "results_released",
      entity: "order",
      entityId: order.id,
      patientId: order.patient_mrn,
      facilityId: encounter?.facility_id ?? null,
      actorId: input.releaserId,
      actorName: input.releaserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: {
        service: order.service_code,
        analytes: pending.map((r) => r.analyte),
        panic,
        licence: licence.number ?? null,
      },
    });

    return { released: pending.length, panic };
  });
}

/**
 * Correct a released result.
 *
 * The old value is superseded, not overwritten — somebody acted on it. The
 * clinician is told, because a correction they never saw is worse than the
 * original error.
 */
export function correctResult(input: {
  resultId: string;
  value?: number;
  valueText?: string;
  reason: string;
  byUserId: number;
  byUserName: string;
  deviceCode: string;
}): string {
  const original = get<LabResult>(`SELECT * FROM lab_results WHERE id = ?`, input.resultId);
  if (!original) throw new LabError("no such result");
  if (original.superseded_at) throw new LabError("that result has already been corrected");
  if (!input.reason.trim()) throw new LabError("correcting a result must record why");

  const decision = check(input.byUserId, "lab.result.release");
  if (!decision.allowed) throw new LabError(explain(decision));

  const order = getOrder(original.order_id)!;
  const range = rangeFor(original.analyte, original.patient_mrn);
  const valueMilli = input.value === undefined ? null : toMilli(input.value);
  const flag =
    valueMilli === null
      ? /^(positive|reactive|detected|seen)/i.test(input.valueText?.trim() ?? "")
        ? "abnormal"
        : "normal"
      : flagFor(valueMilli, range);

  const id = mintLocalId(input.deviceCode, 8);
  const at = now();
  const licence = licenceStatus(input.byUserId);
  const encounter = getEncounter(order.encounter_id);

  return tx(() => {
    run(`UPDATE lab_results SET superseded_at = ? WHERE id = ?`, at, input.resultId);
    run(
      `INSERT INTO lab_results
         (id, order_id, patient_mrn, analyte, value_milli, value_text, unit, low_milli, high_milli,
          flag, status, entered_by, entered_by_name, released_by, releaser_name, releaser_licence,
          released_at, supersedes, correction_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'corrected', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      order.id,
      original.patient_mrn,
      original.analyte,
      valueMilli,
      input.valueText?.trim() ?? "",
      original.unit,
      range?.low_milli ?? null,
      range?.high_milli ?? null,
      flag,
      input.byUserId,
      input.byUserName,
      input.byUserId,
      input.byUserName,
      licence.state === "current" ? (licence.number ?? null) : null,
      at,
      input.resultId,
      input.reason.trim(),
      at,
    );

    // A corrected result is unacknowledged again: the clinician saw the old one.
    run(
      `UPDATE orders SET status = 'resulted', acknowledged_at = NULL, acknowledged_by = NULL, updated_at = ? WHERE id = ?`,
      at,
      order.id,
    );

    notify({
      facilityId: encounter?.facility_id ?? 1,
      ownerRole: "clinician",
      severity: flag === "panic_low" || flag === "panic_high" ? "critical" : "warning",
      kind: "result_corrected",
      subject: `Corrected ${original.analyte} for ${order.patient_mrn}`,
      body: `Was ${formatValue(original.value_milli, original.unit) || original.value_text}, now ${
        formatValue(valueMilli, original.unit) || (input.valueText ?? "")
      }. ${input.reason.trim()}`,
      entity: "order",
      entityId: order.id,
      dedupeKey: `corrected:${id}`,
    });

    audit({
      action: "result_corrected",
      entity: "order",
      entityId: order.id,
      patientId: original.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: {
        analyte: original.analyte,
        was: original.value_milli ?? original.value_text,
        now: valueMilli ?? input.valueText,
        reason: input.reason,
      },
    });

    return id;
  });
}

/** The current results on an order. Superseded values are not here. */
export function resultsFor(orderId: string): LabResult[] {
  return all<LabResult>(
    `SELECT * FROM lab_results WHERE order_id = ? AND superseded_at IS NULL ORDER BY analyte`,
    orderId,
  );
}

/** Every version, including superseded ones. The answer to "what did it say then?" */
export function resultHistory(orderId: string): LabResult[] {
  return all<LabResult>(`SELECT * FROM lab_results WHERE order_id = ? ORDER BY created_at`, orderId);
}

/** A patient's released results, newest first — the cumulative report. */
export function patientResults(patientMrn: string, limit = 100): (LabResult & { service_name: string })[] {
  return all(
    `SELECT r.*, o.service_name FROM lab_results r JOIN orders o ON o.id = r.order_id
      WHERE r.patient_mrn = ? AND r.released_at IS NOT NULL AND r.superseded_at IS NULL
      ORDER BY r.created_at DESC LIMIT ?`,
    patientMrn,
    limit,
  );
}

/** The report as it reads on paper, and as it is attached to the encounter. */
export function reportText(order: Order, results: LabResult[]): string {
  const lines = [
    `${order.service_name} (${order.service_code})`,
    `Patient: ${order.patient_mrn}`,
    `Ordered: ${order.created_at.slice(0, 16).replace("T", " ")} by ${order.orderer_name}`,
    order.clinical_question ? `Clinical question: ${order.clinical_question}` : "",
    "",
  ].filter(Boolean);

  for (const r of results) {
    const value = r.value_milli === null ? r.value_text : formatValue(r.value_milli, r.unit);
    const range =
      r.low_milli !== null && r.high_milli !== null
        ? `  (ref ${formatValue(r.low_milli)}–${formatValue(r.high_milli)} ${r.unit})`
        : "";
    const mark =
      r.flag === "panic_low" || r.flag === "panic_high"
        ? "  *** CRITICAL ***"
        : r.flag === "normal"
          ? ""
          : `  [${r.flag.toUpperCase()}]`;
    lines.push(`${r.analyte.padEnd(12)} ${value}${range}${mark}`);
  }

  return lines.join("\n");
}

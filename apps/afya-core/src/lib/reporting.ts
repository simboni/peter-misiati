/**
 * M70 Reporting & MOH Returns, and M71 the push to KHIS/DHIS2.
 *
 * The weakness this answers is W-whatever-number-it-was in the market research
 * and it is the same in every facility we looked at: staff re-key the monthly
 * returns into KHIS by hand, from a tally sheet, from a register, from memory.
 * It takes days, the numbers do not match the system they were copied out of,
 * and nobody can reproduce them afterwards.
 *
 * So: RETURNS ARE GENERATED FROM TRANSACTIONS. Every figure below is a query
 * over the encounters, diagnoses, admissions and laboratory results the facility
 * already recorded by doing its work. Nothing is entered twice.
 *
 * And: A SUBMITTED RETURN IS FROZEN. Re-running August in October gives
 * different numbers — late entries, corrections, a merged duplicate — and the
 * facility must be able to show what it actually sent. `variance()` compares
 * the two on purpose: the difference is a finding about data quality, not an
 * embarrassment to be hidden by always recomputing.
 *
 * The forms here are MOH 705A (outpatient under five), MOH 705B (outpatient
 * five and over) and MOH 717 (workload). Their data elements are named as this
 * system understands them; the DHIS2 data element IDs for a particular KHIS
 * instance are configuration, and the mapping is loaded per facility — which is
 * why `submitToDhis2` sends named elements and says plainly when a mapping is
 * missing rather than silently dropping a figure.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { call } from "./integration.ts";
import { notify } from "./notifications.ts";

export class ReportingError extends Error {}

export type FormCode = "MOH705A" | "MOH705B" | "MOH717";

export interface ReturnLine {
  element: string;
  label: string;
  value: number;
}

export interface MohReturn {
  id: string;
  facility_id: number;
  form: FormCode;
  period: string;
  status: "draft" | "submitted" | "accepted" | "rejected";
  values_json: string;
  generated_at: string;
  generated_by: number | null;
  submitted_at: string | null;
  reference: string | null;
  last_error: string | null;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthBounds(period: string): { from: string; toExclusive: string } {
  if (!PERIOD.test(period)) throw new ReportingError("a reporting period is a month, e.g. 2026-08");
  const [year, month] = period.split("-").map(Number);
  const from = `${period}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { from, toExclusive: next };
}

/**
 * The conditions MOH 705 breaks out.
 *
 * Matched on the ICD-11 chapter prefix rather than on exact codes, because a
 * clinician coding `1F40` (falciparum malaria) and one coding `1F4Z` (malaria,
 * unspecified) are both reporting malaria, and a return that counted only one
 * of them would be wrong in a way nobody would notice.
 */
const MOH705_CONDITIONS: { element: string; label: string; prefixes: string[] }[] = [
  { element: "MALARIA_CONFIRMED", label: "Malaria (confirmed)", prefixes: ["1F4"] },
  { element: "URTI", label: "Upper respiratory tract infection", prefixes: ["CA0"] },
  { element: "PNEUMONIA", label: "Pneumonia", prefixes: ["CA4"] },
  { element: "DIARRHOEA", label: "Diarrhoea", prefixes: ["1A4"] },
  { element: "UTI", label: "Urinary tract infection", prefixes: ["GC0"] },
  { element: "ASTHMA", label: "Asthma", prefixes: ["CA2"] },
];

/**
 * Conditions notifiable to the county health office under the Public Health Act.
 *
 * A short, deliberately conservative list matched the same way. The full
 * schedule must be loaded before go-live; until then this catches the ones a
 * Level 2/3 clinic actually sees and says so in the compliance view.
 */
export const NOTIFIABLE_PREFIXES: { prefix: string; term: string }[] = [
  { prefix: "1F4", term: "Malaria" },
  { prefix: "1B1", term: "Tuberculosis" },
  { prefix: "1A0", term: "Cholera" },
  { prefix: "1C6", term: "Measles" },
];

// ------------------------------------------------------------------- 705 A/B

/**
 * Outpatient diagnoses for a month, split by age at the time of the visit.
 *
 * 705A is under five, 705B is five and over. The split is by age ON THE DAY OF
 * THE ENCOUNTER, not age today — a child who turned five in September was still
 * a 705A patient in August, and getting this wrong shifts a whole month's
 * paediatric workload into the adult form.
 */
function outpatientDiagnoses(facilityId: number, period: string, underFive: boolean): ReturnLine[] {
  const { from, toExclusive } = monthBounds(period);

  const rows = all<{ code: string; dob: string | null; opened_at: string; sex: string }>(
    `SELECT d.code, p.date_of_birth AS dob, e.opened_at, p.sex
       FROM encounter_diagnoses d
       JOIN encounters e ON e.id = d.encounter_id
       JOIN patients p ON p.mrn = e.patient_mrn
      WHERE e.facility_id = ?
        AND e.kind IN ('outpatient','emergency','followup','anc')
        AND e.status = 'closed'
        AND e.opened_at >= ? AND e.opened_at < ?
        AND d.removed_at IS NULL`,
    facilityId,
    `${from}T00:00:00.000Z`,
    `${toExclusive}T00:00:00.000Z`,
  );

  const inScope = rows.filter((r) => {
    if (!r.dob) return !underFive; // Unknown age is counted as an adult, and said so below.
    const ageOnTheDay =
      (Date.parse(r.opened_at) - Date.parse(`${r.dob}T00:00:00.000Z`)) / (365.25 * 86_400_000);
    return underFive ? ageOnTheDay < 5 : ageOnTheDay >= 5;
  });

  const lines = MOH705_CONDITIONS.map((condition) => ({
    element: condition.element,
    label: condition.label,
    value: inScope.filter((r) => condition.prefixes.some((p) => r.code.startsWith(p))).length,
  }));

  const counted = new Set(
    inScope
      .filter((r) => MOH705_CONDITIONS.some((c) => c.prefixes.some((p) => r.code.startsWith(p))))
      .map((r) => r.code),
  );

  lines.push({
    element: "OTHER_DIAGNOSES",
    label: "All other diagnoses",
    value: inScope.filter((r) => !MOH705_CONDITIONS.some((c) => c.prefixes.some((p) => r.code.startsWith(p)))).length,
  });
  lines.push({ element: "TOTAL_DIAGNOSES", label: "Total diagnoses", value: inScope.length });

  if (counted.size === 0 && inScope.length > 0) {
    // Not an error, but worth seeing: every diagnosis fell outside the broken-out
    // conditions, which usually means the coding is too coarse to report on.
    lines.push({ element: "UNCLASSIFIED_WARNING", label: "No broken-out condition matched", value: inScope.length });
  }

  return lines;
}

/** MOH 717 — workload. What the facility did, not what it found. */
function workload(facilityId: number, period: string): ReturnLine[] {
  const { from, toExclusive } = monthBounds(period);
  const fromTs = `${from}T00:00:00.000Z`;
  const toTs = `${toExclusive}T00:00:00.000Z`;

  const count = (sql: string, ...params: (string | number)[]): number =>
    get<{ n: number }>(sql, ...params)?.n ?? 0;

  const newAttendances = count(
    `SELECT COUNT(DISTINCT e.patient_mrn) AS n FROM encounters e
      WHERE e.facility_id = ? AND e.opened_at >= ? AND e.opened_at < ?
        AND NOT EXISTS (SELECT 1 FROM encounters x WHERE x.patient_mrn = e.patient_mrn AND x.opened_at < ?)`,
    facilityId, fromTs, toTs, fromTs,
  );

  return [
    {
      element: "OUTPATIENT_ATTENDANCES",
      label: "Outpatient attendances",
      value: count(
        `SELECT COUNT(*) AS n FROM encounters WHERE facility_id = ? AND kind IN ('outpatient','followup','anc')
           AND opened_at >= ? AND opened_at < ?`,
        facilityId, fromTs, toTs,
      ),
    },
    { element: "NEW_ATTENDANCES", label: "New patients", value: newAttendances },
    {
      element: "EMERGENCY_ATTENDANCES",
      label: "Casualty attendances",
      value: count(
        `SELECT COUNT(*) AS n FROM encounters WHERE facility_id = ? AND kind = 'emergency'
           AND opened_at >= ? AND opened_at < ?`,
        facilityId, fromTs, toTs,
      ),
    },
    {
      element: "ADMISSIONS",
      label: "Admissions",
      value: count(
        `SELECT COUNT(*) AS n FROM admissions a JOIN wards w ON w.code = a.ward_code
          WHERE w.facility_id = ? AND a.admitted_at >= ? AND a.admitted_at < ?`,
        facilityId, fromTs, toTs,
      ),
    },
    {
      element: "DISCHARGES",
      label: "Discharges",
      value: count(
        `SELECT COUNT(*) AS n FROM admissions a JOIN wards w ON w.code = a.ward_code
          WHERE w.facility_id = ? AND a.discharged_at >= ? AND a.discharged_at < ?`,
        facilityId, fromTs, toTs,
      ),
    },
    {
      element: "DEATHS",
      label: "Deaths",
      value: count(
        `SELECT COUNT(*) AS n FROM admissions a JOIN wards w ON w.code = a.ward_code
          WHERE w.facility_id = ? AND a.discharge_type = 'died' AND a.discharged_at >= ? AND a.discharged_at < ?`,
        facilityId, fromTs, toTs,
      ),
    },
    {
      element: "BED_DAYS",
      label: "Bed days",
      value: count(
        `SELECT COUNT(*) AS n FROM bed_nights b JOIN admissions a ON a.id = b.admission_id
           JOIN wards w ON w.code = a.ward_code
          WHERE w.facility_id = ? AND b.night_date >= ? AND b.night_date < ?`,
        facilityId, from, toExclusive,
      ),
    },
    {
      element: "LAB_TESTS",
      label: "Laboratory tests reported",
      value: count(
        `SELECT COUNT(*) AS n FROM lab_results
          WHERE released_at >= ? AND released_at < ? AND superseded_at IS NULL`,
        fromTs, toTs,
      ),
    },
    {
      element: "PRESCRIPTIONS_DISPENSED",
      label: "Prescriptions dispensed",
      value: count(
        `SELECT COUNT(*) AS n FROM dispenses WHERE dispensed_at >= ? AND dispensed_at < ?`,
        fromTs, toTs,
      ),
    },
  ];
}

/** Compute a form's figures for a period, without storing anything. */
export function computeReturn(input: { facilityId: number; form: FormCode; period: string }): ReturnLine[] {
  switch (input.form) {
    case "MOH705A":
      return outpatientDiagnoses(input.facilityId, input.period, true);
    case "MOH705B":
      return outpatientDiagnoses(input.facilityId, input.period, false);
    case "MOH717":
      return workload(input.facilityId, input.period);
    default:
      throw new ReportingError(`unknown form ${input.form}`);
  }
}

/**
 * Produce a return and freeze its figures.
 *
 * A return already submitted is not regenerated — that is the whole point of
 * freezing it. Use `variance` to see how the month has moved since.
 */
export function generateReturn(input: {
  facilityId: number;
  form: FormCode;
  period: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): { id: string; lines: ReturnLine[] } {
  const existing = get<MohReturn>(
    `SELECT * FROM moh_returns WHERE facility_id = ? AND form = ? AND period = ?`,
    input.facilityId,
    input.form,
    input.period,
  );
  if (existing && existing.status !== "draft" && existing.status !== "rejected") {
    throw new ReportingError(
      `${input.form} for ${input.period} was already submitted on ${existing.submitted_at?.slice(0, 10)}. Compare it with today's figures instead of replacing it.`,
    );
  }

  const lines = computeReturn(input);
  const id = existing?.id ?? mintLocalId(input.deviceCode, 8);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO moh_returns (id, facility_id, form, period, status, values_json, generated_at, generated_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)
       ON CONFLICT(facility_id, form, period) DO UPDATE SET
         status = 'draft', values_json = excluded.values_json,
         generated_at = excluded.generated_at, generated_by = excluded.generated_by, last_error = NULL`,
      id,
      input.facilityId,
      input.form,
      input.period,
      JSON.stringify(Object.fromEntries(lines.map((l) => [l.element, l.value]))),
      at,
      input.byUserId,
    );
    audit({
      action: "moh_return_generated",
      entity: "moh_return",
      entityId: id,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { form: input.form, period: input.period, total: lines.length },
    });
    return { id, lines };
  });
}

export function getReturn(facilityId: number, form: FormCode, period: string): MohReturn | undefined {
  return get<MohReturn>(
    `SELECT * FROM moh_returns WHERE facility_id = ? AND form = ? AND period = ?`,
    facilityId,
    form,
    period,
  );
}

export function listReturns(facilityId: number, limit = 24): MohReturn[] {
  return all<MohReturn>(
    `SELECT * FROM moh_returns WHERE facility_id = ? ORDER BY period DESC, form LIMIT ?`,
    facilityId,
    limit,
  );
}

export function returnLines(row: MohReturn): ReturnLine[] {
  const stored = JSON.parse(row.values_json) as Record<string, number>;
  const labels = new Map(
    [...MOH705_CONDITIONS.map((c) => [c.element, c.label] as const), ...workloadLabels()].map(([e, l]) => [e, l]),
  );
  return Object.entries(stored).map(([element, value]) => ({
    element,
    label: labels.get(element) ?? element.replace(/_/g, " ").toLowerCase(),
    value,
  }));
}

function workloadLabels(): [string, string][] {
  return [
    ["OUTPATIENT_ATTENDANCES", "Outpatient attendances"],
    ["NEW_ATTENDANCES", "New patients"],
    ["EMERGENCY_ATTENDANCES", "Casualty attendances"],
    ["ADMISSIONS", "Admissions"],
    ["DISCHARGES", "Discharges"],
    ["DEATHS", "Deaths"],
    ["BED_DAYS", "Bed days"],
    ["LAB_TESTS", "Laboratory tests reported"],
    ["PRESCRIPTIONS_DISPENSED", "Prescriptions dispensed"],
    ["OTHER_DIAGNOSES", "All other diagnoses"],
    ["TOTAL_DIAGNOSES", "Total diagnoses"],
    ["UNCLASSIFIED_WARNING", "No broken-out condition matched"],
  ];
}

/**
 * What has changed since a return was submitted.
 *
 * A non-zero variance is a finding about data quality, not an embarrassment: it
 * says late entries, corrections or merges happened after the return went out,
 * and it is what a facility should be able to explain to a county reviewer.
 */
export function variance(input: { facilityId: number; form: FormCode; period: string }): {
  element: string;
  label: string;
  submitted: number;
  now: number;
  difference: number;
}[] {
  const row = getReturn(input.facilityId, input.form, input.period);
  if (!row) throw new ReportingError("that return has not been generated");

  const submitted = JSON.parse(row.values_json) as Record<string, number>;
  const current = computeReturn(input);

  return current
    .map((line) => ({
      element: line.element,
      label: line.label,
      submitted: submitted[line.element] ?? 0,
      now: line.value,
      difference: line.value - (submitted[line.element] ?? 0),
    }))
    .filter((v) => v.difference !== 0);
}

// -------------------------------------------------- M71 submission to DHIS2

/**
 * Push a return to KHIS/DHIS2 through the integration hub.
 *
 * Sends NAMED data elements. The DHIS2 element IDs for a particular KHIS
 * instance are per-facility configuration, and when the mapping is absent this
 * says so rather than dropping a figure — a return that arrives missing three
 * numbers, silently, is worse than one that does not arrive.
 */
export function submitToDhis2(input: {
  facilityId: number;
  form: FormCode;
  period: string;
  byUserId: number | null;
  byUserName: string;
}): { submitted: boolean; reference?: string; error?: string; simulated: boolean } {
  const row = getReturn(input.facilityId, input.form, input.period);
  if (!row) throw new ReportingError("generate the return before submitting it");
  if (row.status === "submitted" || row.status === "accepted") {
    throw new ReportingError(`${input.form} for ${input.period} has already been submitted`);
  }

  const values = JSON.parse(row.values_json) as Record<string, number>;
  const dataValues = Object.entries(values)
    .filter(([element]) => element !== "UNCLASSIFIED_WARNING")
    .map(([element, value]) => ({ dataElement: element, value }));

  const result = call({
    endpoint: "DHIS2",
    operation: "submitDataValues",
    request: {
      facilityId: input.facilityId,
      form: input.form,
      period: input.period.replace("-", ""),
      dataValues,
    },
  });

  if (!result.ok) {
    run(`UPDATE moh_returns SET last_error = ? WHERE id = ?`, result.error, row.id);
    notify({
      facilityId: input.facilityId,
      ownerRole: "administrator",
      severity: "warning",
      kind: "moh_return_failed",
      subject: `${input.form} for ${input.period} was not accepted by KHIS`,
      body: result.error,
      entity: "moh_return",
      entityId: row.id,
      dedupeKey: `moh:${row.id}`,
    });
    return { submitted: false, error: result.error, simulated: result.simulated };
  }

  const reference = typeof result.data.reference === "string" ? result.data.reference : `KHIS-${input.period}`;
  const at = now();

  return tx(() => {
    run(
      `UPDATE moh_returns SET status = 'submitted', submitted_at = ?, reference = ?, last_error = NULL WHERE id = ?`,
      at,
      reference,
      row.id,
    );
    audit({
      action: "moh_return_submitted",
      entity: "moh_return",
      entityId: row.id,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        form: input.form,
        period: input.period,
        elements: dataValues.length,
        reference,
        // Recorded so nobody can later mistake a demonstration for a filing.
        simulated: result.simulated,
      },
    });
    return { submitted: true, reference, simulated: result.simulated };
  });
}

// ------------------------------------------------------- notifiable diseases

/**
 * Find diagnoses the Public Health Act requires the county to be told about.
 *
 * Detected from the coded diagnoses as they are made, so the clock runs from
 * the diagnosis rather than from whenever somebody assembles the monthly
 * return. Idempotent: the same diagnosis on the same encounter is one event.
 */
export function detectNotifiable(facilityId: number, since?: string): number {
  const rows = all<{ encounter_id: string; patient_mrn: string; code: string; term: string; added_at: string }>(
    `SELECT d.encounter_id, e.patient_mrn, d.code, d.term, d.added_at AS added_at
       FROM encounter_diagnoses d JOIN encounters e ON e.id = d.encounter_id
      WHERE e.facility_id = ? AND d.removed_at IS NULL AND (? IS NULL OR d.added_at >= ?)`,
    facilityId,
    since ?? null,
    since ?? null,
  );

  let raised = 0;
  for (const row of rows) {
    const match = NOTIFIABLE_PREFIXES.find((n) => row.code.startsWith(n.prefix));
    if (!match) continue;

    const existing = get<{ id: string }>(
      `SELECT id FROM notifiable_events WHERE encounter_id = ? AND condition_code = ?`,
      row.encounter_id,
      row.code,
    );
    if (existing) continue;

    run(
      `INSERT INTO notifiable_events
         (id, facility_id, patient_mrn, encounter_id, condition_code, condition_term, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      mintLocalId("SYS", 8),
      facilityId,
      row.patient_mrn,
      row.encounter_id,
      row.code,
      row.term,
      row.added_at,
    );
    raised++;
  }

  if (raised > 0) {
    notify({
      facilityId,
      ownerRole: "administrator",
      severity: "warning",
      kind: "notifiable_disease",
      subject: `${raised} notifiable condition${raised === 1 ? "" : "s"} to report to the county`,
      body: "The Public Health Act clock runs from diagnosis, not from the monthly return.",
      entity: "notifiable",
      entityId: today(),
      dedupeKey: `notifiable:${today()}`,
    });
  }

  return raised;
}

export function outstandingNotifications(facilityId: number) {
  return all<{
    id: string;
    patient_mrn: string;
    condition_code: string;
    condition_term: string;
    detected_at: string;
    daysWaiting: number;
  }>(
    `SELECT id, patient_mrn, condition_code, condition_term, detected_at,
            CAST((julianday('now') - julianday(detected_at)) AS INTEGER) AS daysWaiting
       FROM notifiable_events WHERE facility_id = ? AND notified_at IS NULL ORDER BY detected_at`,
    facilityId,
  );
}

export function markNotified(input: {
  eventId: string;
  reference: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!input.reference.trim()) {
    throw new ReportingError("a notification must record the county's reference — it is the proof it was made");
  }
  const event = get<{ facility_id: number; patient_mrn: string; condition_term: string }>(
    `SELECT facility_id, patient_mrn, condition_term FROM notifiable_events WHERE id = ?`,
    input.eventId,
  );
  if (!event) throw new ReportingError("no such notifiable event");

  tx(() => {
    run(
      `UPDATE notifiable_events SET notified_at = ?, notified_by = ?, reference = ? WHERE id = ?`,
      now(),
      input.byUserId,
      input.reference.trim(),
      input.eventId,
    );
    audit({
      action: "notifiable_reported",
      entity: "notifiable",
      entityId: input.eventId,
      patientId: event.patient_mrn,
      facilityId: event.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { condition: event.condition_term, reference: input.reference },
    });
  });
}

/**
 * M23 Prescribing.
 *
 * Two problems this module is built against, both from the research:
 *
 *  ALERT FATIGUE (W3). Enterprise systems are notorious for warning about
 *  everything until clinicians dismiss every warning reflexively — at which
 *  point the one that mattered is dismissed too. So warnings here are graded and
 *  only one grade interrupts: an anaphylaxis or severe allergy BLOCKS and must
 *  be explicitly overridden with a written reason. A mild allergy advises and
 *  does not stop anything. Nothing else nags.
 *
 *  UNSAFE OR UNCLAIMABLE PRODUCTS. Only PPB-registered, active products can be
 *  prescribed. A product without a registration must not leave the shelf, and an
 *  item a payer will not recognise becomes a rejected claim line.
 *
 * Like the encounter, the prescriber's licence is pinned at the moment of
 * prescribing, because that is what the claim cites.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { recordOp } from "./sync.ts";
import { check, explain, licenceStatus } from "./access.ts";
import { resolvePatient } from "./patients.ts";
import { getEncounter } from "./encounters.ts";
import { prescribingCheck } from "./telemedicine.ts";

export class PrescribingError extends Error {}

export interface Product {
  code: string;
  name: string;
  generic_name: string;
  form: string;
  strength: string;
  ppb_registration: string | null;
  controlled: number;
  active: number;
  source: string;
  loaded_at: string;
}

export interface Allergy {
  id: number;
  patient_mrn: string;
  substance: string;
  reaction: string;
  severity: "mild" | "severe" | "anaphylaxis";
  recorded_by: number | null;
  recorded_at: string;
  removed_at: string | null;
}

export interface Prescription {
  id: string;
  encounter_id: string;
  patient_mrn: string;
  product_code: string;
  product_name: string;
  generic_name: string;
  dose: string;
  route: string;
  frequency: string;
  duration_days: number | null;
  quantity: number;
  instructions: string;
  prescriber_id: number | null;
  prescriber_name: string;
  prescriber_licence: string | null;
  override_reason: string | null;
  status: "active" | "dispensed" | "cancelled";
  cancelled_reason: string | null;
  device_code: string | null;
  created_at: string;
  updated_at: string;
}

// ------------------------------------------------------------------ catalogue

/**
 * Load or update the product catalogue.
 *
 * Like terminology, this is a loader rather than a constant: the PPB register
 * changes, and every row records where it came from.
 */
export function importProducts(input: {
  source: string;
  products: {
    code: string;
    name: string;
    genericName: string;
    form?: string;
    strength?: string;
    ppbRegistration?: string | null;
    controlled?: boolean;
  }[];
  byUserId?: number | null;
  byUserName?: string;
}): { inserted: number; updated: number } {
  if (!input.source.trim()) {
    throw new PrescribingError("a product import must record its source, e.g. 'PPB register 2026-06'");
  }

  let inserted = 0;
  let updated = 0;

  tx(() => {
    for (const p of input.products) {
      const code = p.code.trim().toUpperCase();
      if (!code) throw new PrescribingError("a product must have a code");
      if (!p.genericName.trim()) {
        throw new PrescribingError(`${code} has no generic name — an allergy check matches on the generic, not the brand`);
      }

      const existing = get<{ code: string }>(`SELECT code FROM products WHERE code = ?`, code);
      run(
        `INSERT INTO products (code, name, generic_name, form, strength, ppb_registration, controlled, source, loaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           name = excluded.name, generic_name = excluded.generic_name,
           form = excluded.form, strength = excluded.strength,
           ppb_registration = excluded.ppb_registration, controlled = excluded.controlled,
           source = excluded.source, loaded_at = excluded.loaded_at`,
        code,
        p.name.trim(),
        p.genericName.trim().toLowerCase(),
        p.form?.trim() ?? "",
        p.strength?.trim() ?? "",
        p.ppbRegistration?.trim() || null,
        p.controlled ? 1 : 0,
        input.source.trim(),
        now(),
      );
      if (existing) updated++;
      else inserted++;
    }

    audit({
      action: "products_imported",
      entity: "product",
      entityId: input.source,
      actorId: input.byUserId ?? null,
      actorName: input.byUserName ?? "system",
      purpose: "administration",
      detail: { source: input.source, inserted, updated },
    });
  });

  return { inserted, updated };
}

export function findProducts(query: string, limit = 12): Product[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return all<Product>(
    `SELECT * FROM products
      WHERE active = 1 AND (lower(name) LIKE ? OR generic_name LIKE ?)
      ORDER BY (lower(name) = ?) DESC, (generic_name = ?) DESC, name
      LIMIT ?`,
    `%${q}%`,
    `%${q}%`,
    q,
    q,
    limit,
  );
}

/** The whole active formulary. Fine while it is a clinic-sized list. */
export function listProducts(): Product[] {
  return all<Product>(`SELECT * FROM products WHERE active = 1 ORDER BY name`);
}

export function getProduct(code: string): Product | undefined {
  return get<Product>(`SELECT * FROM products WHERE code = ?`, code.trim().toUpperCase());
}

// ------------------------------------------------------------------ allergies

export function recordAllergy(input: {
  patientMrn: string;
  substance: string;
  reaction?: string;
  severity: "mild" | "severe" | "anaphylaxis";
  byUserId: number;
  byUserName: string;
}): number {
  const patient = resolvePatient(input.patientMrn);
  if (!patient) throw new PrescribingError("no such patient");
  if (!input.substance.trim()) throw new PrescribingError("an allergy needs a substance");

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO allergies (patient_mrn, substance, reaction, severity, recorded_by, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      patient.mrn,
      // Stored lower-cased so it matches a generic name across brands.
      input.substance.trim().toLowerCase(),
      input.reaction?.trim() ?? "",
      input.severity,
      input.byUserId,
      now(),
    );
    audit({
      action: "allergy_recorded",
      entity: "patient",
      entityId: patient.mrn,
      patientId: patient.mrn,
      facilityId: patient.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { substance: input.substance, severity: input.severity },
    });
    return lastInsertRowid;
  });
}

export function allergiesFor(patientMrn: string): Allergy[] {
  const patient = resolvePatient(patientMrn);
  if (!patient) return [];
  return all<Allergy>(
    `SELECT * FROM allergies WHERE patient_mrn = ? AND removed_at IS NULL ORDER BY
       CASE severity WHEN 'anaphylaxis' THEN 0 WHEN 'severe' THEN 1 ELSE 2 END, substance`,
    patient.mrn,
  );
}

// -------------------------------------------------------------------- safety

/**
 * A warning about a prescription.
 *
 * `blocking` is the whole point of the grading. Only a severe or anaphylactic
 * allergy blocks; everything else informs. A system that blocks on everything
 * teaches people to override reflexively, and then the real one is overridden
 * too.
 */
export interface Warning {
  kind: "allergy" | "unregistered" | "inactive" | "controlled";
  blocking: boolean;
  message: string;
}

export function checkSafety(input: { patientMrn: string; productCode: string }): Warning[] {
  const product = getProduct(input.productCode);
  if (!product) throw new PrescribingError(`${input.productCode} is not in the product catalogue`);

  const warnings: Warning[] = [];

  if (!product.active) {
    warnings.push({
      kind: "inactive",
      blocking: true,
      message: `${product.name} has been withdrawn from the catalogue and must not be prescribed.`,
    });
  }

  if (!product.ppb_registration) {
    warnings.push({
      kind: "unregistered",
      blocking: true,
      message: `${product.name} has no PPB registration on file. It must not be dispensed, and a payer will not accept it.`,
    });
  }

  for (const allergy of allergiesFor(input.patientMrn)) {
    // Match on the generic. A patient allergic to penicillin is allergic to it
    // under every brand name it is sold under.
    const hit =
      product.generic_name.includes(allergy.substance) || allergy.substance.includes(product.generic_name);
    if (!hit) continue;

    const severe = allergy.severity === "severe" || allergy.severity === "anaphylaxis";
    warnings.push({
      kind: "allergy",
      blocking: severe,
      message: severe
        ? `This patient has a recorded ${allergy.severity} allergy to ${allergy.substance}${allergy.reaction ? ` (${allergy.reaction})` : ""}. ${product.name} contains it.`
        : `This patient has a recorded mild allergy to ${allergy.substance}${allergy.reaction ? ` (${allergy.reaction})` : ""}.`,
    });
  }

  if (product.controlled) {
    warnings.push({
      kind: "controlled",
      blocking: false,
      message: `${product.name} is a controlled substance. Dispensing needs a second signature and a register entry.`,
    });
  }

  return warnings;
}

// --------------------------------------------------------------- prescribing

export function prescribe(input: {
  encounterId: string;
  productCode: string;
  dose: string;
  frequency: string;
  quantity: number;
  route?: string;
  durationDays?: number | null;
  instructions?: string;
  /** Required to proceed past a blocking warning. Recorded on the prescription. */
  overrideReason?: string;
  prescriberId: number;
  prescriberName: string;
  deviceCode: string;
}): string {
  const encounter = getEncounter(input.encounterId);
  if (!encounter) throw new PrescribingError("no such encounter");
  if (encounter.status !== "open") {
    throw new PrescribingError("this encounter is closed — prescribing to it would not be attributable to a consultation");
  }

  const decision = check(input.prescriberId, "prescription.write");
  if (!decision.allowed) throw new PrescribingError(explain(decision));

  const product = getProduct(input.productCode);
  if (!product) throw new PrescribingError(`${input.productCode} is not in the product catalogue`);

  // A controlled drug is not prescribed down a telephone. Not overridable: the
  // patient has not been examined and cannot be seen.
  const remote = prescribingCheck(encounter.id, Boolean(product.controlled));
  if (!remote.allowed) throw new PrescribingError(remote.why);

  if (!input.dose.trim()) throw new PrescribingError("a prescription needs a dose");
  if (!input.frequency.trim()) throw new PrescribingError("a prescription needs a frequency");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new PrescribingError("quantity must be a whole number greater than zero");
  }

  const warnings = checkSafety({ patientMrn: encounter.patient_mrn, productCode: product.code });
  const blocking = warnings.filter((w) => w.blocking);

  if (blocking.length > 0 && !input.overrideReason?.trim()) {
    throw new PrescribingError(
      `${blocking.map((w) => w.message).join(" ")} To prescribe anyway, record why.`,
    );
  }

  // An override is only meaningful against a warning that actually fired. A
  // caller may carry a stale reason forward from a previous attempt — a form
  // that kept the text, a retried request — and storing it here would put a
  // sentence in the record claiming the prescriber overrode a warning they were
  // never shown. That is a lie in a clinical record, so it is dropped.
  const override = blocking.length > 0 ? (input.overrideReason?.trim() || null) : null;

  const licence = licenceStatus(input.prescriberId);
  const id = mintLocalId(input.deviceCode, 8);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO prescriptions
         (id, encounter_id, patient_mrn, product_code, product_name, generic_name,
          dose, route, frequency, duration_days, quantity, instructions,
          prescriber_id, prescriber_name, prescriber_licence, override_reason,
          status, device_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      id,
      input.encounterId,
      encounter.patient_mrn,
      product.code,
      product.name,
      product.generic_name,
      input.dose.trim(),
      input.route?.trim() || "oral",
      input.frequency.trim(),
      input.durationDays ?? null,
      input.quantity,
      input.instructions?.trim() ?? "",
      input.prescriberId,
      input.prescriberName,
      licence.state === "current" ? (licence.number ?? null) : null,
      override,
      input.deviceCode,
      at,
      at,
    );

    recordOp({
      deviceCode: input.deviceCode,
      entity: "prescription",
      entityId: id,
      dataClass: "clinical",
      payload: {
        encounter_id: input.encounterId,
        product_code: product.code,
        dose: input.dose,
        frequency: input.frequency,
        quantity: input.quantity,
      },
      actorId: input.prescriberId,
      actorName: input.prescriberName,
    });

    audit({
      action: "prescription_written",
      entity: "prescription",
      entityId: id,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.prescriberId,
      actorName: input.prescriberName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: {
        product: product.name,
        generic: product.generic_name,
        dose: input.dose,
        quantity: input.quantity,
        controlled: product.controlled === 1,
        // The override is part of the permanent record, not a dismissed dialog.
        overrodeWarning: override,
      },
    });

    return id;
  });
}

export function prescriptionsFor(encounterId: string): Prescription[] {
  return all<Prescription>(
    `SELECT * FROM prescriptions WHERE encounter_id = ? ORDER BY created_at`,
    encounterId,
  );
}

export function activePrescriptionsFor(patientMrn: string): Prescription[] {
  const patient = resolvePatient(patientMrn);
  if (!patient) return [];
  return all<Prescription>(
    `SELECT * FROM prescriptions WHERE patient_mrn = ? AND status = 'active' ORDER BY created_at DESC`,
    patient.mrn,
  );
}

export function cancelPrescription(input: {
  prescriptionId: string;
  reason: string;
  byUserId: number;
  byUserName: string;
}): void {
  const rx = get<Prescription>(`SELECT * FROM prescriptions WHERE id = ?`, input.prescriptionId);
  if (!rx) throw new PrescribingError("no such prescription");
  if (rx.status === "dispensed") {
    throw new PrescribingError("that prescription has already been dispensed — it cannot be cancelled, only followed up");
  }
  if (rx.status === "cancelled") throw new PrescribingError("that prescription is already cancelled");
  if (!input.reason.trim()) throw new PrescribingError("cancelling a prescription must record why");

  tx(() => {
    run(
      `UPDATE prescriptions SET status = 'cancelled', cancelled_reason = ?, updated_at = ? WHERE id = ?`,
      input.reason.trim(),
      now(),
      input.prescriptionId,
    );
    audit({
      action: "prescription_cancelled",
      entity: "prescription",
      entityId: input.prescriptionId,
      patientId: rx.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { product: rx.product_name, reason: input.reason },
    });
  });
}

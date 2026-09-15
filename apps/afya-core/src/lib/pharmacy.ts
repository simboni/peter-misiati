/**
 * M40 Pharmacy & Dispensing — where the prescription meets the shelf.
 *
 * This is the module that makes the system's central claim true: ONE EVENT,
 * FOUR CONSEQUENCES. A clinician prescribes; a pharmacist dispenses; and in
 * that single act the stock comes off the shelf, the charge appears on the
 * bill, the claim line becomes defensible, and the controlled-drug register
 * updates. Nobody re-keys any of it, because re-keying is where the four
 * numbers stop agreeing.
 *
 * What it refuses, and why:
 *
 *   an unregistered product   PPB registration is what makes dispensing lawful
 *   an expired or recalled    never pickable, whatever is on the shelf
 *   batch
 *   a substitution with no    the generic that was handed over is what the
 *   reason                    patient took; the difference must be explained
 *   a controlled drug         the register is inspected, and the entry must
 *   without the licence        name a licensed person
 *   dispensing to a           a prescription belongs to a consultation
 *   cancelled prescription
 *
 * Partial dispensing is normal and is not an error: a pharmacy with 20 of 30
 * gives 20, says so, and the prescription stays partly outstanding.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { check, explain, licenceStatus } from "./access.ts";
import { getProduct, type Prescription } from "./prescribing.ts";
import { addCharge, chargesFor, voidCharge } from "./billing.ts";
import { allocate, consume, getStore, onHand, type Allocation } from "./inventory.ts";

export class PharmacyError extends Error {}

export interface Dispense {
  id: string;
  prescription_id: string;
  patient_mrn: string;
  encounter_id: string;
  store_code: string;
  product_code: string;
  quantity: number;
  substitution_reason: string | null;
  counselling: string;
  dispensed_by: number | null;
  dispenser_name: string;
  dispenser_licence: string | null;
  device_code: string | null;
  dispensed_at: string;
}

// ------------------------------------------------------------------ worklist

export interface WorklistItem {
  prescription: Prescription;
  patientName: string;
  dispensed: number;
  outstanding: number;
  onHand: number;
  /** True when the pharmacy cannot fill the outstanding quantity today. */
  short: boolean;
  controlled: boolean;
}

/**
 * What is waiting at the counter.
 *
 * Carries the stock position with each line, because the question a pharmacist
 * asks first is not "what was prescribed" but "can I fill it" — and finding out
 * by trying is how a queue forms.
 */
export function worklist(storeCode: string): WorklistItem[] {
  const rows = all<Prescription & { patient_name: string; dispensed: number }>(
    `SELECT r.*,
            p.given_name || ' ' || p.family_name AS patient_name,
            COALESCE((SELECT SUM(d.quantity) FROM dispenses d WHERE d.prescription_id = r.id), 0) AS dispensed
       FROM prescriptions r
       JOIN patients p ON p.mrn = r.patient_mrn
      WHERE r.status = 'active'
      ORDER BY r.created_at`,
  );

  return rows.map((r) => {
    const outstanding = r.quantity - r.dispensed;
    const available = onHand(storeCode, r.product_code);
    return {
      prescription: r,
      patientName: r.patient_name,
      dispensed: r.dispensed,
      outstanding,
      onHand: available,
      short: available < outstanding,
      controlled: getProduct(r.product_code)?.controlled === 1,
    };
  });
}

export function dispensesFor(prescriptionId: string): Dispense[] {
  return all<Dispense>(
    `SELECT * FROM dispenses WHERE prescription_id = ? ORDER BY dispensed_at`,
    prescriptionId,
  );
}

/** How much of a prescription has actually been handed over. */
export function dispensedQuantity(prescriptionId: string): number {
  return (
    get<{ q: number }>(
      `SELECT COALESCE(SUM(quantity), 0) AS q FROM dispenses WHERE prescription_id = ?`,
      prescriptionId,
    )?.q ?? 0
  );
}

// ------------------------------------------------------------------ the check

export interface DispenseCheck {
  canDispense: boolean;
  outstanding: number;
  available: number;
  allocations: Allocation[];
  /** Reasons dispensing is impossible right now. */
  blockers: string[];
  /** Things the pharmacist must see but which do not stop them. */
  warnings: string[];
}

/**
 * Everything the pharmacist needs to decide, before anything moves.
 *
 * Separated from `dispense` so the counter screen can show the batch that would
 * be picked, and the shortfall, without committing to anything.
 */
export function checkDispense(input: {
  prescriptionId: string;
  storeCode: string;
  quantity?: number;
  productCode?: string;
  dispenserId: number;
  /** The session asking, so a controlled drug needs a recent code, not just enrolment. */
  sessionToken?: string | null;
}): DispenseCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const rx = get<Prescription>(`SELECT * FROM prescriptions WHERE id = ?`, input.prescriptionId);
  if (!rx) throw new PharmacyError("no such prescription");

  const store = getStore(input.storeCode);
  if (!store) throw new PharmacyError(`no such store ${input.storeCode}`);
  if (!store.dispensing) blockers.push(`${store.name} is not a dispensing point.`);

  if (rx.status === "cancelled") blockers.push("That prescription was cancelled.");

  const already = dispensedQuantity(rx.id);
  const outstanding = rx.quantity - already;
  if (outstanding <= 0) blockers.push("That prescription has already been dispensed in full.");

  const wanted = input.quantity ?? Math.max(outstanding, 0);
  if (wanted > outstanding) {
    blockers.push(`Only ${outstanding} of ${rx.quantity} is still outstanding.`);
  }

  const productCode = (input.productCode ?? rx.product_code).trim().toUpperCase();
  const product = getProduct(productCode);
  if (!product) {
    blockers.push(`${productCode} is not in the product catalogue.`);
  } else {
    if (!product.ppb_registration) {
      blockers.push(`${product.name} has no PPB registration on file. It must not be dispensed.`);
    }
    if (product.active !== 1) warnings.push(`${product.name} has been withdrawn from the catalogue.`);

    if (productCode !== rx.product_code) {
      const prescribed = getProduct(rx.product_code);
      if (prescribed && prescribed.generic_name.toLowerCase() !== product.generic_name.toLowerCase()) {
        // Swapping the active ingredient is not substitution, it is a different
        // prescription, and only the prescriber can make it.
        blockers.push(
          `${product.name} is ${product.generic_name}, not ${prescribed.generic_name}. That is a change of medicine, not a substitution — it needs the prescriber.`,
        );
      } else {
        warnings.push(`Substituting ${product.name} for ${rx.product_name}. The reason is recorded on the record.`);
      }
    }

    if (product.controlled) {
      const decision = check(input.dispenserId, "dispense.controlled", undefined, input.sessionToken);
      if (!decision.allowed) blockers.push(explain(decision));
      warnings.push("Controlled drug. This entry goes on the register the PPB inspects.");
    } else {
      const decision = check(input.dispenserId, "dispense.perform");
      if (!decision.allowed) blockers.push(explain(decision));
    }
  }

  const plan = allocate(input.storeCode, productCode, Math.max(wanted, 0));
  if (plan.short > 0) {
    warnings.push(
      plan.allocated === 0
        ? `No stock of ${product?.name ?? productCode} in ${store?.name ?? input.storeCode}.`
        : `Only ${plan.allocated} available — ${plan.short} short. Dispensing part of it is recorded as part.`,
    );
  }

  return {
    canDispense: blockers.length === 0 && plan.allocated > 0,
    outstanding: Math.max(outstanding, 0),
    available: plan.allocated,
    allocations: plan.allocations,
    blockers,
    warnings,
  };
}

// ------------------------------------------------------------------- dispense

/**
 * Hand medicine over.
 *
 * One transaction, four consequences: the stock ledger, the dispensing record
 * with its batches, the bill, and the prescription's own status. If any of them
 * fails none of them happened — which is the only way the four stay equal.
 *
 * The quantity dispensed is what the shelf could actually cover. A pharmacy
 * with 20 of 30 gives 20 and the prescription stays partly outstanding; it is
 * not an error and it is not silently rounded up.
 */
export function dispense(input: {
  prescriptionId: string;
  storeCode: string;
  /** Omit to dispense everything outstanding that stock allows. */
  quantity?: number;
  /** Set only when substituting. Must be the same generic. */
  productCode?: string;
  substitutionReason?: string;
  counselling?: string;
  payerCode: string;
  dispenserId: number;
  dispenserName: string;
  deviceCode: string;
  /** The session asking. Required in practice for a controlled drug. */
  sessionToken?: string | null;
}): { dispenseId: string; quantity: number; outstanding: number; batches: Allocation[] } {
  const rx = get<Prescription>(`SELECT * FROM prescriptions WHERE id = ?`, input.prescriptionId);
  if (!rx) throw new PharmacyError("no such prescription");

  const verdict = checkDispense({
    prescriptionId: input.prescriptionId,
    storeCode: input.storeCode,
    quantity: input.quantity,
    productCode: input.productCode,
    dispenserId: input.dispenserId,
    sessionToken: input.sessionToken,
  });

  if (verdict.blockers.length > 0) throw new PharmacyError(verdict.blockers.join(" "));
  if (verdict.available === 0) {
    throw new PharmacyError(
      `Nothing to dispense — there is no usable stock of ${input.productCode ?? rx.product_code} in that store.`,
    );
  }

  const productCode = (input.productCode ?? rx.product_code).trim().toUpperCase();
  const substituting = productCode !== rx.product_code;
  if (substituting && !input.substitutionReason?.trim()) {
    // What the patient took is what was handed over. An unexplained difference
    // between the prescription and the pack is the ambiguity that hurts people.
    throw new PharmacyError("substituting for the prescribed product must record why");
  }

  const quantity = verdict.available;
  const id = mintLocalId(input.deviceCode, 8);
  const licence = licenceStatus(input.dispenserId);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO dispenses
         (id, prescription_id, patient_mrn, encounter_id, store_code, product_code, quantity,
          substitution_reason, counselling, dispensed_by, dispenser_name, dispenser_licence,
          device_code, dispensed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      rx.id,
      rx.patient_mrn,
      rx.encounter_id,
      input.storeCode.trim().toUpperCase(),
      productCode,
      quantity,
      substituting ? input.substitutionReason!.trim() : null,
      input.counselling?.trim() ?? "",
      input.dispenserId,
      input.dispenserName,
      licence.state === "current" ? (licence.number ?? null) : null,
      input.deviceCode,
      at,
    );

    for (const a of verdict.allocations) {
      run(
        `INSERT INTO dispense_batches (dispense_id, batch_id, quantity) VALUES (?, ?, ?)`,
        id,
        a.batchId,
        a.quantity,
      );
    }

    // 1. Off the shelf, against the batches that were picked.
    consume({
      allocations: verdict.allocations,
      kind: "dispense",
      reference: id,
      patientMrn: rx.patient_mrn,
      byUserId: input.dispenserId,
      byUserName: input.dispenserName,
    });

    // 2. On the bill — as what was ACTUALLY handed over.
    //
    //    `assembleCharges` may already have billed this prescription when it was
    //    written. That charge is what was ordered; this one is what was given,
    //    and they are not always the same quantity or even the same product. So
    //    the ordered charge is voided and replaced rather than added to, because
    //    a patient billed twice for one box of amoxicillin is the kind of error
    //    that ends a pilot.
    //
    //    Only on the first dispense: a second, partial dispense adds its own
    //    line, which is correct — two collections, two quantities.
    const ordered = chargesFor(rx.encounter_id).find(
      (c) => c.source_kind === "prescription" && c.source_ref === rx.id,
    );
    if (ordered) {
      voidCharge({
        chargeId: ordered.id,
        reason: `Replaced by what was dispensed (${id})`,
        byUserId: input.dispenserId,
        byUserName: input.dispenserName,
      });
    }

    //    The charge cites the dispensing event, so a query about a line on an
    //    invoice leads back to the pack that was handed over.
    addCharge({
      encounterId: rx.encounter_id,
      serviceCode: productCode,
      quantity,
      payerCode: input.payerCode,
      sourceKind: "prescription",
      sourceRef: id,
      deviceCode: input.deviceCode,
      byUserId: input.dispenserId,
      byUserName: input.dispenserName,
    });

    // 3. The prescription's own state follows what was actually handed over.
    const total = dispensedQuantity(rx.id);
    if (total >= rx.quantity) {
      run(`UPDATE prescriptions SET status = 'dispensed', updated_at = ? WHERE id = ?`, at, rx.id);
    }

    // 4. The record. A controlled drug lands on the register through the stock
    //    movement above; this is the clinical and data-protection entry.
    audit({
      action: "medicine_dispensed",
      entity: "prescription",
      entityId: rx.id,
      patientId: rx.patient_mrn,
      actorId: input.dispenserId,
      actorName: input.dispenserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: {
        dispenseId: id,
        product: productCode,
        prescribed: rx.product_code,
        quantity,
        substituted: substituting,
        substitutionReason: substituting ? input.substitutionReason : null,
        batches: verdict.allocations.map((a) => a.batchNumber),
        controlled: getProduct(productCode)?.controlled === 1,
      },
    });

    return {
      dispenseId: id,
      quantity,
      outstanding: rx.quantity - total,
      batches: verdict.allocations,
    };
  });
}

/**
 * What a patient was given, across every visit.
 *
 * The answer to "what is he actually taking" — which the prescription list
 * cannot give, because a prescription is an intention and a dispense is a fact.
 */
export function dispensingHistory(patientMrn: string): (Dispense & { product_name: string })[] {
  return all(
    `SELECT d.*, p.name AS product_name
       FROM dispenses d JOIN products p ON p.code = d.product_code
      WHERE d.patient_mrn = ? ORDER BY d.dispensed_at DESC`,
    patientMrn,
  );
}

/** The batches behind one dispensing event, for a recall or a query. */
export function batchesDispensed(dispenseId: string): { batch_number: string; expires_on: string; quantity: number }[] {
  return all(
    `SELECT b.batch_number, b.expires_on, db.quantity
       FROM dispense_batches db JOIN stock_batches b ON b.id = db.batch_id
      WHERE db.dispense_id = ?`,
    dispenseId,
  );
}

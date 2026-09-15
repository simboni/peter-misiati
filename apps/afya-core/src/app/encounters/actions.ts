"use server";

/**
 * The consultation.
 *
 * Designed against one budget: a standard outpatient consultation in under 90
 * seconds and under 15 interactions. Everything here serves that — the note is
 * one form saved once, favourite diagnoses are a single tap, and closing the
 * encounter is the same submit that saves the note when the record is ready.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth.ts";
import {
  openEncounter, writeNote, addDiagnosis, removeDiagnosis, closeEncounter, readiness,
} from "@/lib/encounters.ts";
import { placeOrder, acknowledgeResult } from "@/lib/orders.ts";
import { act } from "@/app/_components/act.ts";
import { deviceFor } from "@/app/_components/device.ts";
import { activeDevice, listDevices } from "@/lib/facility.ts";
import { getEncounter } from "@/lib/encounters.ts";
import { prescribe, cancelPrescription, checkSafety, recordAllergy } from "@/lib/prescribing.ts";
import { assembleCharges, issueInvoice, invoiceForEncounter } from "@/lib/billing.ts";
import { assembleClaim, claimForEncounter } from "@/lib/claims.ts";
import { getPayer, verifyCoverage } from "@/lib/payers.ts";

async function device(sessionDevice: string | null, facilityId: number): Promise<string> {
  if (sessionDevice && activeDevice(sessionDevice)) return sessionDevice;
  const devices = listDevices(facilityId).filter((d) => !d.revoked_at);
  if (!devices.length) throw new Error("No device is registered for this facility.");
  return devices[0].code;
}

export async function startEncounterAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const mrn = String(formData.get("mrn") ?? "");
  const id = openEncounter({
    facilityId: user.facilityId,
    patientMrn: mrn,
    kind: "outpatient",
    clinicianId: user.userId,
    clinicianName: user.name,
    deviceCode: await device(user.deviceCode, user.facilityId),
  });
  redirect(`/encounters/${encodeURIComponent(id)}`);
}

export type ConsultState = { error?: string; saved?: boolean };

/**
 * Save the note, and close the encounter if the clinician asked to.
 *
 * One action rather than two so "write up and finish" is one interaction. When
 * the record is not ready to close, the note is still saved — losing a
 * clinician's typing because a code is missing is how a system gets worked
 * around.
 */
export async function saveConsultAction(_prev: ConsultState, formData: FormData): Promise<ConsultState> {
  const user = await requireUser();
  const encounterId = String(formData.get("encounterId") ?? "");
  const finish = formData.get("finish") === "yes";

  try {
    const deviceCode = await device(user.deviceCode, user.facilityId);

    writeNote({
      encounterId,
      complaint: String(formData.get("complaint") ?? ""),
      history: String(formData.get("history") ?? ""),
      examination: String(formData.get("examination") ?? ""),
      assessment: String(formData.get("assessment") ?? ""),
      plan: String(formData.get("plan") ?? ""),
      authorId: user.userId,
      authorName: user.name,
      deviceCode,
    });

    if (finish) {
      const state = readiness(encounterId);
      if (!state.ready) return { saved: true, error: state.blockers.join(" ") };
      closeEncounter({ encounterId, byUserId: user.userId, byUserName: user.name, deviceCode });
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save." };
  }

  if (finish) redirect(`/patients/${encodeURIComponent(String(formData.get("mrn") ?? ""))}`);
  revalidatePath(`/encounters/${encounterId}`);
  return { saved: true };
}

export async function addDiagnosisAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const encounterId = String(formData.get("encounterId") ?? "");
  addDiagnosis({
    encounterId,
    code: String(formData.get("code") ?? ""),
    rank: Number(formData.get("rank") ?? 1),
    byUserId: user.userId,
    byUserName: user.name,
    deviceCode: await device(user.deviceCode, user.facilityId),
  });
  revalidatePath(`/encounters/${encounterId}`);
}

export async function removeDiagnosisAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  removeDiagnosis({
    diagnosisId: Number(formData.get("diagnosisId")),
    byUserId: user.userId,
    byUserName: user.name,
    reason: String(formData.get("reason") ?? "removed during consultation"),
  });
  revalidatePath(`/encounters/${String(formData.get("encounterId") ?? "")}`);
}

// --------------------------------------------------------------- prescribing

export type PrescribeState = {
  error?: string;
  /** Blocking warnings the prescriber must answer before proceeding. */
  blocked?: string[];
  /** Advisory warnings — shown, never in the way. */
  advice?: string[];
  values?: Record<string, string>;
};

/**
 * Write a prescription.
 *
 * A blocking warning comes back as `blocked` with the form's values intact, so
 * the prescriber answers it in place rather than retyping. An override is only
 * accepted with a written reason, which goes onto the prescription permanently.
 */
export async function prescribeAction(_prev: PrescribeState, formData: FormData): Promise<PrescribeState> {
  const user = await requireUser();
  const encounterId = String(formData.get("encounterId") ?? "");

  const values = {
    productCode: String(formData.get("productCode") ?? "").trim(),
    dose: String(formData.get("dose") ?? "").trim(),
    frequency: String(formData.get("frequency") ?? "").trim(),
    quantity: String(formData.get("quantity") ?? "").trim(),
    durationDays: String(formData.get("durationDays") ?? "").trim(),
    instructions: String(formData.get("instructions") ?? "").trim(),
  };
  const overrideReason = String(formData.get("overrideReason") ?? "").trim();

  if (!values.productCode) return { error: "Choose a product.", values };

  try {
    const deviceCode = await device(user.deviceCode, user.facilityId);
    const encounter = getEncounter(encounterId);
    if (!encounter) return { error: "No such encounter.", values };

    // Show advisory warnings even on the happy path — a mild allergy is worth
    // knowing, just not worth blocking on.
    const warnings = checkSafety({ patientMrn: encounter.patient_mrn, productCode: values.productCode });
    const advice = warnings.filter((w) => !w.blocking).map((w) => w.message);
    const blocking = warnings.filter((w) => w.blocking).map((w) => w.message);

    if (blocking.length > 0 && !overrideReason) {
      return { blocked: blocking, advice, values };
    }

    prescribe({
      encounterId,
      productCode: values.productCode,
      dose: values.dose,
      frequency: values.frequency,
      quantity: Number(values.quantity),
      durationDays: values.durationDays ? Number(values.durationDays) : null,
      instructions: values.instructions,
      overrideReason: overrideReason || undefined,
      prescriberId: user.userId,
      prescriberName: user.name,
      deviceCode,
    });

    revalidatePath(`/encounters/${encounterId}`);
    return { advice };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not prescribe.", values };
  }
}

export async function cancelPrescriptionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  cancelPrescription({
    prescriptionId: String(formData.get("prescriptionId") ?? ""),
    reason: String(formData.get("reason") ?? "cancelled during consultation"),
    byUserId: user.userId,
    byUserName: user.name,
  });
  revalidatePath(`/encounters/${String(formData.get("encounterId") ?? "")}`);
}

/**
 * Record an allergy.
 *
 * Lives on the consultation screen because that is where a patient says "the
 * last tablets gave me a rash" — an allergy captured later, at a desk, is an
 * allergy not captured.
 */
export async function recordAllergyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const encounterId = String(formData.get("encounterId") ?? "");
  recordAllergy({
    patientMrn: String(formData.get("mrn") ?? ""),
    substance: String(formData.get("substance") ?? ""),
    reaction: String(formData.get("reaction") ?? ""),
    severity: (String(formData.get("severity") ?? "severe") as "mild" | "severe" | "anaphylaxis"),
    byUserId: user.userId,
    byUserName: user.name,
  });
  revalidatePath(`/encounters/${encounterId}`);
}

// ------------------------------------------------------- billing and claims

/**
 * Bill the encounter, invoice it, and assemble the claim — one action.
 *
 * Deliberately one step: a facility that has to remember three separate buttons
 * forgets one, and a forgotten invoice is a tax compliance failure while a
 * forgotten claim is simply unpaid work.
 */
export async function billEncounterAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const encounterId = String(formData.get("encounterId") ?? "");
  const payerCode = String(formData.get("payerCode") ?? "CASH");
  const deviceCode = await device(user.deviceCode, user.facilityId);

  assembleCharges({
    encounterId,
    payerCode,
    deviceCode,
    byUserId: user.userId,
    byUserName: user.name,
  });

  if (!invoiceForEncounter(encounterId)) {
    issueInvoice({ encounterId, payerCode, deviceCode, byUserId: user.userId, byUserName: user.name });
  }

  // A cash patient is not claimed against; they pay at the counter.
  const payer = getPayer(payerCode);
  if (payer && payer.kind !== "cash" && !claimForEncounter(encounterId)) {
    assembleClaim({ encounterId, payerCode, deviceCode, byUserId: user.userId, byUserName: user.name });
  }

  revalidatePath(`/encounters/${encounterId}`);
}

export async function verifyCoverageAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  verifyCoverage({
    patientMrn: String(formData.get("mrn") ?? ""),
    payerCode: String(formData.get("payerCode") ?? "SHA"),
    memberNumber: String(formData.get("memberNumber") ?? ""),
    byUserId: user.userId,
    byUserName: user.name,
  });
  revalidatePath(`/encounters/${String(formData.get("encounterId") ?? "")}`);
}

/**
 * Order an investigation from the consultation.
 *
 * The charge is raised in the same breath, which is the point: an
 * investigation done and not billed is revenue the facility never sees, and one
 * billed but not ordered is a claim that gets rejected.
 */
export async function placeOrderAction(formData: FormData): Promise<void> {
  const encounterId = String(formData.get("encounterId") ?? "");
  await act(`/encounters/${encodeURIComponent(encounterId)}`, async () => {
    const user = await requireUser();
    placeOrder({
      encounterId,
      kind: String(formData.get("kind") ?? "lab") as "lab" | "imaging" | "procedure",
      serviceCode: String(formData.get("serviceCode") ?? ""),
      priority: String(formData.get("priority") ?? "routine") as "routine" | "urgent" | "stat",
      clinicalQuestion: String(formData.get("clinicalQuestion") ?? "").trim() || undefined,
      payerCode: String(formData.get("payerCode") ?? "CASH"),
      ordererId: user.userId,
      ordererName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

/** A clinician says they have seen a result. The state that closes the loop. */
export async function acknowledgeOrderAction(formData: FormData): Promise<void> {
  const encounterId = String(formData.get("encounterId") ?? "");
  await act(`/encounters/${encodeURIComponent(encounterId)}`, async () => {
    const user = await requireUser();
    acknowledgeResult({
      orderId: String(formData.get("orderId") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
      action: String(formData.get("action") ?? "").trim() || undefined,
    });
  });
}

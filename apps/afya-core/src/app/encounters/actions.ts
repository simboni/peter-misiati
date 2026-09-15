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
import { activeDevice, listDevices } from "@/lib/facility.ts";

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

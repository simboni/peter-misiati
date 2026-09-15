"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import { activeDevice, listDevices } from "@/lib/facility.ts";
import { checkIn, setPriority, advanceVisit, recordVitals, type Priority } from "@/lib/frontdesk.ts";
import { openEncounterFor, openEncounter } from "@/lib/encounters.ts";

async function device(sessionDevice: string | null, facilityId: number): Promise<string> {
  if (sessionDevice && activeDevice(sessionDevice)) return sessionDevice;
  const devices = listDevices(facilityId).filter((d) => !d.revoked_at);
  if (!devices.length) throw new Error("No device is registered for this facility.");
  return devices[0].code;
}

export async function checkInAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  requirePermission(user.userId, "queue.manage", { actorName: user.name, facilityId: user.facilityId });
  checkIn({
    facilityId: user.facilityId,
    patientMrn: String(formData.get("mrn") ?? ""),
    priority: (String(formData.get("priority") ?? "routine") as Priority),
    deviceCode: await device(user.deviceCode, user.facilityId),
    byUserId: user.userId,
    byUserName: user.name,
  });
  revalidatePath("/queue");
}

export async function setPriorityAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  requirePermission(user.userId, "triage.record", { actorName: user.name, facilityId: user.facilityId });
  setPriority({
    visitId: String(formData.get("visitId") ?? ""),
    priority: (String(formData.get("priority") ?? "routine") as Priority),
    byUserId: user.userId,
    byUserName: user.name,
  });
  revalidatePath("/queue");
}

export async function recordVitalsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  requirePermission(user.userId, "triage.record", { actorName: user.name, facilityId: user.facilityId });
  const num = (k: string) => {
    const raw = String(formData.get(k) ?? "").trim();
    return raw === "" ? undefined : Number(raw);
  };
  const tempC = num("tempC");
  recordVitals({
    visitId: String(formData.get("visitId") ?? ""),
    // The nurse types 38.9; the record keeps 389. Conversion happens once, here.
    tempTenthsC: tempC === undefined ? undefined : Math.round(tempC * 10),
    weightGrams: num("weightKg") === undefined ? undefined : Math.round(num("weightKg")! * 1000),
    systolicMmhg: num("systolic"),
    diastolicMmhg: num("diastolic"),
    pulseBpm: num("pulse"),
    spo2Percent: num("spo2"),
    byUserId: user.userId,
    byUserName: user.name,
  });
  advanceVisit({ visitId: String(formData.get("visitId") ?? ""), state: "waiting", byUserId: user.userId, byUserName: user.name });
  revalidatePath("/queue");
}

/** Start the consultation from the queue — one click from the waiting list. */
export async function seeNextAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const visitId = String(formData.get("visitId") ?? "");
  const mrn = String(formData.get("mrn") ?? "");

  const existing = openEncounterFor(mrn);
  const encounterId =
    existing?.id ??
    openEncounter({
      facilityId: user.facilityId,
      patientMrn: mrn,
      kind: "outpatient",
      clinicianId: user.userId,
      clinicianName: user.name,
      deviceCode: await device(user.deviceCode, user.facilityId),
    });

  advanceVisit({ visitId, state: "in_consultation", encounterId, byUserId: user.userId, byUserName: user.name });
  redirect(`/encounters/${encodeURIComponent(encounterId)}`);
}

export async function closeVisitAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  advanceVisit({
    visitId: String(formData.get("visitId") ?? ""),
    state: "done",
    byUserId: user.userId,
    byUserName: user.name,
  });
  revalidatePath("/queue");
}

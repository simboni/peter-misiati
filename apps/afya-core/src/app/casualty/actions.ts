"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  openAttendance, openUnidentified, identify, triagePatient, startTreatment,
  recordDisposition, openMedicolegalCase, issueP3, declareIncident, standDownIncident,
  type ArrivalMode, type Mobility, type Avpu, type Triage, type Disposition, type MedicolegalKind,
} from "@/lib/emergency.ts";
import { deviceFor } from "@/app/_components/device.ts";

function num(formData: FormData, key: string): number | undefined {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

export async function arriveAction(formData: FormData): Promise<void> {
  await act("/casualty", async () => {
    const user = await requireUser();
    // Deliberately gated on being able to open a visit, not on anything to do
    // with money. Nothing in this action touches a payer.
    requirePermission(user.userId, "queue.manage", { actorName: user.name, facilityId: user.facilityId });
    openAttendance({
      facilityId: user.facilityId,
      patientMrn: String(formData.get("mrn") ?? ""),
      arrivalMode: (text(formData, "arrivalMode") ?? "walk_in") as ArrivalMode,
      presenting: text(formData, "presenting"),
      incidentRef: text(formData, "incidentRef"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function arriveUnknownAction(formData: FormData): Promise<void> {
  await act("/casualty", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "queue.manage", { actorName: user.name, facilityId: user.facilityId });
    openUnidentified({
      facilityId: user.facilityId,
      sex: (text(formData, "sex") ?? "male") as "male" | "female",
      estimatedAge: num(formData, "estimatedAge"),
      arrivalMode: (text(formData, "arrivalMode") ?? "ambulance") as ArrivalMode,
      presenting: text(formData, "presenting"),
      incidentRef: text(formData, "incidentRef"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function identifyAction(formData: FormData): Promise<void> {
  const attendanceId = String(formData.get("attendanceId") ?? "");
  await act(`/casualty?a=${attendanceId}`, async () => {
    const user = await requireUser();
    identify({
      attendanceId,
      realPatientMrn: String(formData.get("mrn") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function triageAction(formData: FormData): Promise<void> {
  const attendanceId = String(formData.get("attendanceId") ?? "");
  await act(`/casualty?a=${attendanceId}`, async () => {
    const user = await requireUser();
    requirePermission(user.userId, "queue.manage", { actorName: user.name, facilityId: user.facilityId });

    const raiseTo = text(formData, "discriminatorTriage");
    triagePatient({
      attendanceId,
      observations: {
        mobility: text(formData, "mobility") as Mobility | undefined,
        respRate: num(formData, "respRate"),
        pulseBpm: num(formData, "pulseBpm"),
        systolicMmhg: num(formData, "systolicMmhg"),
        tempTenthsC: num(formData, "tempC") === undefined ? undefined : Math.round(num(formData, "tempC")! * 10),
        avpu: text(formData, "avpu") as Avpu | undefined,
        trauma: formData.get("trauma") === "on",
      },
      discriminator: text(formData, "discriminator"),
      discriminatorTriage: raiseTo ? (raiseTo as Triage) : undefined,
      deadOnArrival: formData.get("deadOnArrival") === "on",
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function takeAction(formData: FormData): Promise<void> {
  const attendanceId = String(formData.get("attendanceId") ?? "");
  await act(`/casualty?a=${attendanceId}`, async () => {
    const user = await requireUser();
    requirePermission(user.userId, "encounter.conduct", { actorName: user.name, facilityId: user.facilityId });
    startTreatment({
      attendanceId,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function dispositionAction(formData: FormData): Promise<void> {
  await act("/casualty", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "encounter.conduct", { actorName: user.name, facilityId: user.facilityId });
    recordDisposition({
      attendanceId: String(formData.get("attendanceId") ?? ""),
      disposition: String(formData.get("disposition") ?? "discharged") as Disposition,
      note: text(formData, "note"),
      admissionId: text(formData, "admissionId") ?? null,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function medicolegalAction(formData: FormData): Promise<void> {
  const attendanceId = String(formData.get("attendanceId") ?? "");
  await act(`/casualty?a=${attendanceId}`, async () => {
    const user = await requireUser();
    requirePermission(user.userId, "encounter.conduct", { actorName: user.name, facilityId: user.facilityId });
    openMedicolegalCase({
      attendanceId,
      kind: String(formData.get("kind") ?? "assault") as MedicolegalKind,
      policeStation: text(formData, "policeStation"),
      obNumber: text(formData, "obNumber"),
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function p3Action(formData: FormData): Promise<void> {
  const attendanceId = String(formData.get("attendanceId") ?? "");
  await act(`/casualty?a=${attendanceId}`, async () => {
    const user = await requireUser();
    issueP3({
      caseId: String(formData.get("caseId") ?? ""),
      issuedTo: String(formData.get("issuedTo") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function declareAction(formData: FormData): Promise<void> {
  await act("/casualty?view=incidents", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "queue.manage", { actorName: user.name, facilityId: user.facilityId });
    declareIncident({
      facilityId: user.facilityId,
      reference: String(formData.get("reference") ?? ""),
      kind: String(formData.get("kind") ?? ""),
      description: text(formData, "description"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function standDownAction(formData: FormData): Promise<void> {
  await act("/casualty?view=incidents", async () => {
    const user = await requireUser();
    standDownIncident({
      reference: String(formData.get("reference") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

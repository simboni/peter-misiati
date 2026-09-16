"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  receiveBody, recordViewing, recordPostmortem, waivePostmortem,
  recordNotification, release, defineUnit,
  type BodySource, type Identity,
} from "@/lib/mortuary.ts";
import { deviceFor } from "@/app/_components/device.ts";

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

function num(formData: FormData, key: string): number | undefined {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function cents(formData: FormData, key: string): number | undefined {
  const shillings = num(formData, key);
  return shillings === undefined ? undefined : Math.round(shillings * 100);
}

/** The attendant's desk. Registration clerks work it in most Level 2 facilities. */
async function attendant() {
  const user = await requireUser();
  requirePermission(user.userId, "patient.read", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

async function administrator() {
  const user = await requireUser();
  requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function receiveAction(formData: FormData): Promise<void> {
  await act("/mortuary", async () => {
    const user = await attendant();
    receiveBody({
      facilityId: user.facilityId,
      patientMrn: text(formData, "patientMrn"),
      givenName: text(formData, "givenName"),
      familyName: text(formData, "familyName"),
      sex: (text(formData, "sex") ?? "unknown") as "female" | "male" | "unknown",
      ageYears: num(formData, "ageYears"),
      identity: text(formData, "identity") as Identity | undefined,
      source: (text(formData, "source") ?? "brought_in") as BodySource,
      diedAt: text(formData, "diedAt"),
      placeOfDeath: text(formData, "placeOfDeath"),
      unitCode: text(formData, "unitCode"),
      medicoLegal: formData.get("medicoLegal") === "on",
      policeObNo: text(formData, "policeObNo"),
      investigatingOfficer: text(formData, "investigatingOfficer"),
      postmortemRequired: formData.get("postmortemRequired") === "on",
      causeOfDeath: text(formData, "causeOfDeath"),
      certifiedBy: text(formData, "certifiedBy"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function viewingAction(formData: FormData): Promise<void> {
  const bodyId = String(formData.get("bodyId") ?? "");
  await act(`/mortuary?b=${bodyId}`, async () => {
    const user = await attendant();
    recordViewing({
      bodyId,
      personName: String(formData.get("personName") ?? ""),
      personId: String(formData.get("personId") ?? ""),
      relationship: String(formData.get("relationship") ?? ""),
      identified: formData.get("identified") === "yes",
      givenName: text(formData, "givenName"),
      familyName: text(formData, "familyName"),
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function postmortemAction(formData: FormData): Promise<void> {
  const bodyId = String(formData.get("bodyId") ?? "");
  await act(`/mortuary?b=${bodyId}`, async () => {
    const user = await attendant();
    recordPostmortem({
      bodyId,
      pathologist: String(formData.get("pathologist") ?? ""),
      findings: String(formData.get("findings") ?? ""),
      causeOfDeath: String(formData.get("causeOfDeath") ?? ""),
      causeCode: text(formData, "causeCode"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function waivePostmortemAction(formData: FormData): Promise<void> {
  const bodyId = String(formData.get("bodyId") ?? "");
  await act(`/mortuary?b=${bodyId}`, async () => {
    const user = await administrator();
    waivePostmortem({
      bodyId,
      authority: String(formData.get("authority") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function notificationAction(formData: FormData): Promise<void> {
  const bodyId = String(formData.get("bodyId") ?? "");
  await act(`/mortuary?b=${bodyId}`, async () => {
    const user = await attendant();
    recordNotification({
      bodyId,
      reference: String(formData.get("reference") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function releaseAction(formData: FormData): Promise<void> {
  const bodyId = String(formData.get("bodyId") ?? "");
  await act(`/mortuary?b=${bodyId}`, async () => {
    const user = await attendant();
    release({
      bodyId,
      toName: String(formData.get("toName") ?? ""),
      toIdNumber: String(formData.get("toIdNumber") ?? ""),
      relationship: String(formData.get("relationship") ?? ""),
      authority: text(formData, "authority"),
      override: text(formData, "override"),
      waivedCents: cents(formData, "waived"),
      waiverReason: text(formData, "waiverReason"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function unitAction(formData: FormData): Promise<void> {
  await act("/mortuary?view=units", async () => {
    const user = await administrator();
    defineUnit({
      facilityId: user.facilityId,
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
      bays: num(formData, "bays"),
      assetId: text(formData, "assetId"),
    });
  });
}

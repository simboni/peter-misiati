"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  raiseReferral, acceptReferral, declineReferral, departReferral,
  confirmArrival, recordOutcome, cancelReferral,
  type Direction, type Urgency, type Outcome,
} from "@/lib/referrals.ts";
import { deviceFor } from "@/app/_components/device.ts";

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

export async function raiseAction(formData: FormData): Promise<void> {
  const direction = (text(formData, "direction") ?? "out") as Direction;
  await act(`/referrals${direction === "in" ? "?view=in" : ""}`, async () => {
    const user = await requireUser();
    requirePermission(user.userId, "encounter.conduct", { actorName: user.name, facilityId: user.facilityId });
    raiseReferral({
      facilityId: user.facilityId,
      patientMrn: String(formData.get("mrn") ?? ""),
      direction,
      counterpartCode: text(formData, "counterpartCode"),
      externalName: text(formData, "externalName"),
      urgency: (text(formData, "urgency") ?? "routine") as Urgency,
      reason: String(formData.get("reason") ?? ""),
      treatmentGiven: text(formData, "treatmentGiven"),
      clinicalSummary: text(formData, "clinicalSummary"),
      serviceNeeded: text(formData, "serviceNeeded"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function acceptAction(formData: FormData): Promise<void> {
  const referralId = String(formData.get("referralId") ?? "");
  await act(`/referrals?r=${referralId}`, async () => {
    const user = await requireUser();
    acceptReferral({
      referralId,
      acceptedByName: String(formData.get("acceptedByName") ?? ""),
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function declineAction(formData: FormData): Promise<void> {
  const referralId = String(formData.get("referralId") ?? "");
  await act(`/referrals?r=${referralId}`, async () => {
    const user = await requireUser();
    declineReferral({
      referralId,
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function departAction(formData: FormData): Promise<void> {
  const referralId = String(formData.get("referralId") ?? "");
  await act(`/referrals?r=${referralId}`, async () => {
    const user = await requireUser();
    departReferral({
      referralId,
      transport: text(formData, "transport"),
      escort: text(formData, "escort"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function arriveAction(formData: FormData): Promise<void> {
  const referralId = String(formData.get("referralId") ?? "");
  await act(`/referrals?r=${referralId}`, async () => {
    const user = await requireUser();
    confirmArrival({
      referralId,
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function outcomeAction(formData: FormData): Promise<void> {
  await act("/referrals?view=awaiting", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "encounter.conduct", { actorName: user.name, facilityId: user.facilityId });
    recordOutcome({
      referralId: String(formData.get("referralId") ?? ""),
      outcome: (text(formData, "outcome") ?? "treated_returned") as Outcome,
      note: String(formData.get("note") ?? ""),
      outcomeByName: text(formData, "outcomeByName"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function cancelAction(formData: FormData): Promise<void> {
  await act("/referrals", async () => {
    const user = await requireUser();
    cancelReferral({
      referralId: String(formData.get("referralId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

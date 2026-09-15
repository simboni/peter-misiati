"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth.ts";
import { collectSpecimen, rejectSpecimen, enterResult, releaseResults, correctResult } from "@/lib/laboratory.ts";
import { deviceFor } from "@/app/_components/device.ts";

export async function collectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  collectSpecimen({
    orderId: String(formData.get("orderId") ?? ""),
    kind: String(formData.get("kind") ?? "").trim() || "Blood",
    collectorId: user.userId,
    collectorName: user.name,
    deviceCode: deviceFor(user.deviceCode, user.facilityId),
  });
  revalidatePath("/laboratory");
}

export async function rejectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  rejectSpecimen({
    specimenId: String(formData.get("specimenId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    byUserId: user.userId,
    byUserName: user.name,
  });
  revalidatePath("/laboratory");
}

export async function enterResultAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const numeric = String(formData.get("value") ?? "").trim();
  const text = String(formData.get("valueText") ?? "").trim();

  enterResult({
    orderId: String(formData.get("orderId") ?? ""),
    analyte: String(formData.get("analyte") ?? ""),
    value: numeric ? Number(numeric) : undefined,
    valueText: text || undefined,
    unit: String(formData.get("unit") ?? "").trim() || undefined,
    enteredBy: user.userId,
    enteredByName: user.name,
    deviceCode: deviceFor(user.deviceCode, user.facilityId),
  });
  revalidatePath("/laboratory");
}

export async function releaseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  releaseResults({
    orderId: String(formData.get("orderId") ?? ""),
    releaserId: user.userId,
    releaserName: user.name,
    deviceCode: deviceFor(user.deviceCode, user.facilityId),
  });
  revalidatePath("/laboratory");
}

export async function correctAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const numeric = String(formData.get("value") ?? "").trim();
  correctResult({
    resultId: String(formData.get("resultId") ?? ""),
    value: numeric ? Number(numeric) : undefined,
    valueText: String(formData.get("valueText") ?? "").trim() || undefined,
    reason: String(formData.get("reason") ?? ""),
    byUserId: user.userId,
    byUserName: user.name,
    deviceCode: deviceFor(user.deviceCode, user.facilityId),
  });
  revalidatePath("/laboratory");
}

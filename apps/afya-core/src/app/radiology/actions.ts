"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  openStudy, justifyStudy, answerSafetyCheck, performStudy, cancelStudy,
  reportStudy, recordCommunication,
  type Modality, type PregnancyCheck, type ReportKind, type Laterality,
} from "@/lib/radiology.ts";
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

async function radiographer() {
  const user = await requireUser();
  requirePermission(user.userId, "encounter.conduct", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function openStudyAction(formData: FormData): Promise<void> {
  await act("/radiology", async () => {
    const user = await radiographer();
    openStudy({
      orderId: String(formData.get("orderId") ?? ""),
      modality: (text(formData, "modality") ?? "xray") as Modality,
      bodyPart: String(formData.get("bodyPart") ?? ""),
      laterality: (text(formData, "laterality") ?? "not_applicable") as Laterality,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function justifyAction(formData: FormData): Promise<void> {
  const studyId = String(formData.get("studyId") ?? "");
  await act(`/radiology?s=${studyId}`, async () => {
    const user = await radiographer();
    justifyStudy({
      studyId,
      justification: String(formData.get("justification") ?? ""),
      pregnancyCheck: (text(formData, "pregnancyCheck") ?? undefined) as PregnancyCheck | undefined,
      pregnancyNote: text(formData, "pregnancyNote"),
      facilityId: user.facilityId,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function safetyAction(formData: FormData): Promise<void> {
  const studyId = String(formData.get("studyId") ?? "");
  await act(`/radiology?s=${studyId}`, async () => {
    const user = await radiographer();
    answerSafetyCheck({
      studyId,
      itemCode: String(formData.get("itemCode") ?? ""),
      answer: String(formData.get("answer") ?? "no") as "yes" | "no" | "unknown",
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function performAction(formData: FormData): Promise<void> {
  const studyId = String(formData.get("studyId") ?? "");
  await act(`/radiology?s=${studyId}`, async () => {
    const user = await radiographer();
    performStudy({
      studyId,
      radiographerName: String(formData.get("radiographerName") ?? "") || user.name,
      equipment: text(formData, "equipment"),
      doseUgyM2: num(formData, "doseUgyM2"),
      doseUsv: num(formData, "doseUsv"),
      images: num(formData, "images"),
      facilityId: user.facilityId,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function reportAction(formData: FormData): Promise<void> {
  const studyId = String(formData.get("studyId") ?? "");
  await act(`/radiology?s=${studyId}`, async () => {
    const user = await radiographer();
    reportStudy({
      studyId,
      kind: (text(formData, "kind") ?? "final") as ReportKind,
      findings: String(formData.get("findings") ?? ""),
      impression: String(formData.get("impression") ?? ""),
      critical: formData.get("critical") === "on",
      discrepancy: formData.get("discrepancy") === "on",
      discrepancyNote: text(formData, "discrepancyNote"),
      facilityId: user.facilityId,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function communicateAction(formData: FormData): Promise<void> {
  const studyId = String(formData.get("studyId") ?? "");
  await act(`/radiology?view=critical&s=${studyId}`, async () => {
    const user = await requireUser();
    recordCommunication({
      reportId: String(formData.get("reportId") ?? ""),
      communicatedTo: String(formData.get("communicatedTo") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function cancelStudyAction(formData: FormData): Promise<void> {
  await act("/radiology", async () => {
    const user = await radiographer();
    cancelStudy({
      studyId: String(formData.get("studyId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

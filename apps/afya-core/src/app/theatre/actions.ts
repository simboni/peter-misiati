"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  bookCase, recordSurgicalConsent, addTeamMember, answerChecklist, completeStage,
  recordCountIn, recordCountOut, resolveCount, sendFor, arriveInTheatre,
  startAnaesthesia, recordIncision, closeCase, leaveTheatre, completeCase, cancelCase,
  type Urgency, type Stage, type Answer, type Anaesthesia, type Laterality, type CancelCategory,
} from "@/lib/theatre.ts";
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

/** Everything in theatre needs the clinical permission; only booking differs. */
async function surgeon() {
  const user = await requireUser();
  requirePermission(user.userId, "encounter.conduct", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function bookAction(formData: FormData): Promise<void> {
  await act("/theatre", async () => {
    const user = await surgeon();
    bookCase({
      facilityId: user.facilityId,
      patientMrn: String(formData.get("mrn") ?? ""),
      theatreCode: text(formData, "theatreCode"),
      procedurePlanned: String(formData.get("procedurePlanned") ?? ""),
      urgency: (text(formData, "urgency") ?? "elective") as Urgency,
      laterality: (text(formData, "laterality") ?? "not_applicable") as Laterality,
      surgeonId: user.userId,
      surgeonName: text(formData, "surgeonName") ?? user.name,
      anaesthetistName: text(formData, "anaesthetistName"),
      scheduledFor: text(formData, "scheduledFor"),
      estimatedMinutes: num(formData, "estimatedMinutes"),
      asaGrade: num(formData, "asaGrade"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function consentAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  await act(`/theatre?c=${caseId}`, async () => {
    const user = await surgeon();
    recordSurgicalConsent({
      caseId,
      consentedProcedure: text(formData, "consentedProcedure"),
      risksDiscussed: String(formData.get("risksDiscussed") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function teamAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  await act(`/theatre?c=${caseId}`, async () => {
    await surgeon();
    addTeamMember({
      caseId,
      role: String(formData.get("role") ?? ""),
      personName: String(formData.get("personName") ?? ""),
    });
  });
}

export async function answerAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  const stage = String(formData.get("stage") ?? "sign_in") as Stage;
  await act(`/theatre?c=${caseId}&stage=${stage}`, async () => {
    const user = await surgeon();
    answerChecklist({
      caseId, stage,
      itemCode: String(formData.get("itemCode") ?? ""),
      answer: String(formData.get("answer") ?? "yes") as Answer,
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function completeStageAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  const stage = String(formData.get("stage") ?? "sign_in") as Stage;
  await act(`/theatre?c=${caseId}&stage=${stage}`, async () => {
    const user = await surgeon();
    completeStage({ caseId, stage, byUserId: user.userId, byUserName: user.name });
  });
}

export async function countInAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  await act(`/theatre?c=${caseId}`, async () => {
    const user = await surgeon();
    recordCountIn({
      caseId, item: String(formData.get("item") ?? ""),
      count: num(formData, "count") ?? 0,
      byUserId: user.userId, byUserName: user.name,
    });
  });
}

export async function countOutAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  await act(`/theatre?c=${caseId}`, async () => {
    const user = await surgeon();
    recordCountOut({
      caseId, item: String(formData.get("item") ?? ""),
      count: num(formData, "count") ?? 0,
      byUserId: user.userId, byUserName: user.name,
    });
  });
}

export async function resolveCountAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  await act(`/theatre?c=${caseId}`, async () => {
    const user = await surgeon();
    resolveCount({
      caseId, item: String(formData.get("item") ?? ""),
      resolution: String(formData.get("resolution") ?? ""),
      byUserId: user.userId, byUserName: user.name,
    });
  });
}

export async function stepAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  const step = String(formData.get("step") ?? "");
  await act(`/theatre?c=${caseId}`, async () => {
    const user = await surgeon();
    const who = { byUserId: user.userId, byUserName: user.name };
    switch (step) {
      case "send_for": return sendFor({ caseId, ...who });
      case "arrive": return arriveInTheatre({ caseId, ...who });
      case "anaesthetise":
        return startAnaesthesia({
          caseId,
          anaesthesia: (text(formData, "anaesthesia") ?? "general") as Anaesthesia,
          anaesthetistName: String(formData.get("anaesthetistName") ?? ""),
          byUserId: user.userId, byUserName: user.name,
        });
      case "incise": return recordIncision({ caseId, byUserId: user.userId, byUserName: user.name });
      case "leave": return leaveTheatre({ caseId, ...who });
      case "complete": return completeCase({ caseId, ...who });
      default: throw new Error("unknown step");
    }
  });
}

export async function closeAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "");
  await act(`/theatre?c=${caseId}`, async () => {
    const user = await surgeon();
    closeCase({
      caseId,
      procedurePerformed: String(formData.get("procedurePerformed") ?? ""),
      findings: String(formData.get("findings") ?? ""),
      bloodLossMl: num(formData, "bloodLossMl"),
      specimen: text(formData, "specimen"),
      implant: text(formData, "implant"),
      complications: text(formData, "complications"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function cancelAction(formData: FormData): Promise<void> {
  await act("/theatre", async () => {
    const user = await surgeon();
    cancelCase({
      caseId: String(formData.get("caseId") ?? ""),
      category: (text(formData, "category") ?? "other") as CancelCategory,
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

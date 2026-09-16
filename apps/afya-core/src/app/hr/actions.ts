"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  issueContract, requestLeave, decideLeave, markTaken, cancelLeave, adjustLeave,
  openCase, recordHearing, closeCase,
  type ContractKind, type CaseKind, type CaseOutcome,
} from "@/lib/hr.ts";
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

async function hrOfficer() {
  const user = await requireUser();
  requirePermission(user.userId, "user.manage", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function contractAction(formData: FormData): Promise<void> {
  const employeeId = String(formData.get("employeeId") ?? "");
  await act(`/hr?view=staff&e=${employeeId}`, async () => {
    const user = await hrOfficer();
    issueContract({
      employeeId,
      kind: (text(formData, "kind") ?? "permanent") as ContractKind,
      startsOn: String(formData.get("startsOn") ?? ""),
      endsOn: text(formData, "endsOn"),
      noticeDays: num(formData, "noticeDays"),
      terms: text(formData, "terms"),
      signedOn: text(formData, "signedOn"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function requestLeaveAction(formData: FormData): Promise<void> {
  const employeeId = String(formData.get("employeeId") ?? "");
  await act(`/hr?view=staff&e=${employeeId}`, async () => {
    const user = await hrOfficer();
    requestLeave({
      employeeId,
      leaveCode: String(formData.get("leaveCode") ?? ""),
      startsOn: String(formData.get("startsOn") ?? ""),
      endsOn: String(formData.get("endsOn") ?? ""),
      reason: text(formData, "reason"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function decideLeaveAction(formData: FormData): Promise<void> {
  await act("/hr", async () => {
    const user = await hrOfficer();
    decideLeave({
      requestId: String(formData.get("requestId") ?? ""),
      approve: formData.get("decision") === "approve",
      coverEmployeeId: text(formData, "coverEmployeeId"),
      coverNote: text(formData, "coverNote"),
      // Going ahead with nobody registered to cover is allowed, and has to be
      // said in writing.
      uncoveredAck: text(formData, "uncoveredAck"),
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function takenAction(formData: FormData): Promise<void> {
  await act("/hr", async () => {
    const user = await hrOfficer();
    markTaken({ requestId: String(formData.get("requestId") ?? ""), byUserId: user.userId, byUserName: user.name });
  });
}

export async function cancelLeaveAction(formData: FormData): Promise<void> {
  await act("/hr", async () => {
    const user = await hrOfficer();
    cancelLeave({
      requestId: String(formData.get("requestId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function adjustLeaveAction(formData: FormData): Promise<void> {
  const employeeId = String(formData.get("employeeId") ?? "");
  await act(`/hr?view=staff&e=${employeeId}`, async () => {
    const user = await hrOfficer();
    adjustLeave({
      employeeId,
      leaveCode: String(formData.get("leaveCode") ?? ""),
      year: num(formData, "year") ?? new Date().getUTCFullYear(),
      days: num(formData, "days") ?? 0,
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function openCaseAction(formData: FormData): Promise<void> {
  const employeeId = String(formData.get("employeeId") ?? "");
  await act(`/hr?view=cases&e=${employeeId}`, async () => {
    const user = await hrOfficer();
    openCase({
      employeeId,
      kind: (text(formData, "kind") ?? "disciplinary") as CaseKind,
      summary: String(formData.get("summary") ?? ""),
      raisedOn: text(formData, "raisedOn"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function hearingAction(formData: FormData): Promise<void> {
  await act("/hr?view=cases", async () => {
    const user = await hrOfficer();
    recordHearing({
      caseId: String(formData.get("caseId") ?? ""),
      notifiedOn: String(formData.get("notifiedOn") ?? ""),
      heardOn: String(formData.get("heardOn") ?? ""),
      accompaniedBy: text(formData, "accompaniedBy"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function closeCaseAction(formData: FormData): Promise<void> {
  await act("/hr?view=cases", async () => {
    const user = await hrOfficer();
    closeCase({
      caseId: String(formData.get("caseId") ?? ""),
      outcome: (text(formData, "outcome") ?? "no_action") as CaseOutcome,
      note: String(formData.get("note") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

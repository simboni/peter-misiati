"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  addEmployee, endEmployment, addPayItem, createRun, approveRun, payRun, cancelRun,
  type Employment, type PayItemKind,
} from "@/lib/payroll.ts";
import { deviceFor } from "@/app/_components/device.ts";

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

/** Shillings on a form, cents everywhere else. */
function cents(formData: FormData, key: string): number {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/**
 * Payroll is administration, not reporting: seeing what people are paid is a
 * different thing from seeing how many patients came through the door.
 */
async function payrollOfficer() {
  const user = await requireUser();
  requirePermission(user.userId, "user.manage", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function hireAction(formData: FormData): Promise<void> {
  await act("/payroll?view=staff", async () => {
    const user = await payrollOfficer();
    addEmployee({
      facilityId: user.facilityId,
      payrollNo: String(formData.get("payrollNo") ?? ""),
      givenName: String(formData.get("givenName") ?? ""),
      familyName: String(formData.get("familyName") ?? ""),
      nationalId: text(formData, "nationalId"),
      kraPin: text(formData, "kraPin"),
      nssfNo: text(formData, "nssfNo"),
      shifNo: text(formData, "shifNo"),
      jobTitle: text(formData, "jobTitle"),
      department: text(formData, "department"),
      employment: (text(formData, "employment") ?? "permanent") as Employment,
      basicCents: cents(formData, "basic"),
      bankName: text(formData, "bankName"),
      bankAccount: text(formData, "bankAccount"),
      startedOn: String(formData.get("startedOn") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function endEmploymentAction(formData: FormData): Promise<void> {
  await act("/payroll?view=staff", async () => {
    const user = await payrollOfficer();
    endEmployment({
      employeeId: String(formData.get("employeeId") ?? ""),
      endedOn: String(formData.get("endedOn") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function payItemAction(formData: FormData): Promise<void> {
  const employeeId = String(formData.get("employeeId") ?? "");
  await act(`/payroll?view=staff&e=${employeeId}`, async () => {
    const user = await payrollOfficer();
    addPayItem({
      employeeId,
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
      kind: (text(formData, "kind") ?? "allowance") as PayItemKind,
      amountCents: cents(formData, "amount"),
      // Whether an allowance is taxable is the commonest payroll error there
      // is, so the form asks rather than assuming.
      taxable: formData.get("taxable") === "on",
      startsOn: String(formData.get("startsOn") ?? ""),
      endsOn: text(formData, "endsOn"),
      note: text(formData, "note"),
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function runAction(formData: FormData): Promise<void> {
  await act("/payroll", async () => {
    const user = await payrollOfficer();
    createRun({
      facilityId: user.facilityId,
      period: String(formData.get("period") ?? ""),
      payDate: String(formData.get("payDate") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function approveAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId") ?? "");
  await act(`/payroll?r=${runId}`, async () => {
    const user = await payrollOfficer();
    approveRun({ runId, byUserId: user.userId, byUserName: user.name });
  });
}

export async function payAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId") ?? "");
  await act(`/payroll?r=${runId}`, async () => {
    const user = await payrollOfficer();
    payRun({
      runId,
      paymentRef: String(formData.get("paymentRef") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function cancelAction(formData: FormData): Promise<void> {
  await act("/payroll", async () => {
    const user = await payrollOfficer();
    cancelRun({
      runId: String(formData.get("runId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

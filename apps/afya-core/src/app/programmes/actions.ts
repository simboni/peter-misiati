"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import { enrol, recordVisit, recordOutcome, reopen, sweepDefaulters, type EnrolmentStatus } from "@/lib/programmes.ts";
import { deviceFor } from "@/app/_components/device.ts";

export async function enrolAction(formData: FormData): Promise<void> {
  const programme = String(formData.get("programmeCode") ?? "HIV");
  await act(`/programmes?p=${programme}`, async () => {
    const user = await requireUser();
    requirePermission(user.userId, "encounter.conduct", {
      actorName: user.name,
      facilityId: user.facilityId,
    });
    enrol({
      programmeCode: programme,
      patientMrn: String(formData.get("mrn") ?? ""),
      programmeNumber: String(formData.get("programmeNumber") ?? ""),
      enrolledOn: String(formData.get("enrolledOn") ?? "").trim() || undefined,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function visitAction(formData: FormData): Promise<void> {
  const programme = String(formData.get("programmeCode") ?? "HIV");
  await act(`/programmes?p=${programme}`, async () => {
    const user = await requireUser();

    // Programme-specific findings, kept as whatever the clinic actually typed.
    const findings: Record<string, string> = {};
    for (const key of ["viralLoad", "sputum", "bloodPressure", "hba1c", "weightKg", "adherence"]) {
      const value = String(formData.get(key) ?? "").trim();
      if (value) findings[key] = value;
    }

    recordVisit({
      enrolmentId: String(formData.get("enrolmentId") ?? ""),
      visitDate: String(formData.get("visitDate") ?? "").trim() || undefined,
      nextDue: String(formData.get("nextDue") ?? "").trim() || undefined,
      findings,
      note: String(formData.get("note") ?? "").trim() || undefined,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function outcomeAction(formData: FormData): Promise<void> {
  const programme = String(formData.get("programmeCode") ?? "HIV");
  await act(`/programmes?p=${programme}`, async () => {
    const user = await requireUser();
    recordOutcome({
      enrolmentId: String(formData.get("enrolmentId") ?? ""),
      status: String(formData.get("status") ?? "lost") as Exclude<EnrolmentStatus, "active">,
      note: String(formData.get("note") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function reopenAction(formData: FormData): Promise<void> {
  const programme = String(formData.get("programmeCode") ?? "HIV");
  await act(`/programmes?p=${programme}`, async () => {
    const user = await requireUser();
    reopen({
      enrolmentId: String(formData.get("enrolmentId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function sweepAction(): Promise<void> {
  await act("/programmes?view=defaulters", async () => {
    const user = await requireUser();
    sweepDefaulters(user.facilityId);
  });
}

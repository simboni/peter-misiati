"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  enrol, verify, recordException, recordFallback, withdrawEnrolment,
  registerReader, goLive, simulateCapture,
  type Finger, type ExceptionReason,
} from "@/lib/biometrics.ts";
import { recordConsent } from "@/lib/frontdesk.ts";
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

async function clerk() {
  const user = await requireUser();
  requirePermission(user.userId, "patient.read", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

async function administrator() {
  const user = await requireUser();
  requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function consentAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/biometrics?mrn=${mrn}`, async () => {
    const user = await clerk();
    recordConsent({
      patientMrn: mrn,
      purpose: "biometric",
      granted: formData.get("granted") === "yes",
      givenBy: text(formData, "givenBy"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function enrolAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/biometrics?mrn=${mrn}`, async () => {
    const user = await clerk();
    const finger = (text(formData, "finger") ?? "right_thumb") as Finger;
    enrol({
      patientMrn: mrn,
      finger,
      // On a demo reader the capture is simulated here. A live reader's driver
      // hands the template over instead, and nothing else changes.
      capture: simulateCapture(mrn, finger),
      readerCode: String(formData.get("readerCode") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function verifyAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/biometrics?mrn=${mrn}`, async () => {
    const user = await clerk();
    const finger = (text(formData, "finger") ?? "right_thumb") as Finger;
    verify({
      patientMrn: mrn,
      // "The right finger" and "somebody else's" are the two things a
      // demonstration needs to be able to show.
      capture: simulateCapture(mrn, finger, formData.get("present") !== "other"),
      readerCode: String(formData.get("readerCode") ?? ""),
      purpose: text(formData, "purpose") ?? "service",
      finger,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function fallbackAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/biometrics?mrn=${mrn}`, async () => {
    const user = await clerk();
    recordFallback({
      verificationId: num(formData, "verificationId") ?? 0,
      fallback: String(formData.get("fallback") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function exceptionAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/biometrics?mrn=${mrn}`, async () => {
    const user = await clerk();
    recordException({
      patientMrn: mrn,
      reason: (text(formData, "reason") ?? "other") as ExceptionReason,
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function withdrawAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/biometrics?mrn=${mrn}`, async () => {
    const user = await clerk();
    withdrawEnrolment({
      enrolmentId: String(formData.get("enrolmentId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function readerAction(formData: FormData): Promise<void> {
  await act("/biometrics?view=readers", async () => {
    const user = await administrator();
    registerReader({
      facilityId: user.facilityId,
      code: String(formData.get("code") ?? ""),
      label: String(formData.get("label") ?? ""),
      make: text(formData, "make"),
      model: text(formData, "model"),
      threshold: num(formData, "threshold"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function goLiveAction(formData: FormData): Promise<void> {
  await act("/biometrics?view=readers", async () => {
    const user = await administrator();
    goLive({
      code: String(formData.get("code") ?? ""),
      templateFormat: String(formData.get("templateFormat") ?? ""),
      algorithm: String(formData.get("algorithm") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

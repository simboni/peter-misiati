"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  enrol, revoke, sendCode, sendSummary, grantProxy, revokeProxy,
  type Channel, type Language,
} from "@/lib/portal.ts";

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

function num(formData: FormData, key: string): number | undefined {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function desk() {
  const user = await requireUser();
  requirePermission(user.userId, "patient.read", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function enrolAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/portal?mrn=${mrn}`, async () => {
    const user = await desk();
    enrol({
      patientMrn: mrn,
      phone: text(formData, "phone"),
      channel: (text(formData, "channel") ?? "sms") as Channel,
      language: (text(formData, "language") ?? "en") as Language,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function revokeAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/portal?mrn=${mrn}`, async () => {
    const user = await desk();
    revoke({
      patientMrn: mrn,
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function codeAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/portal?mrn=${mrn}&sent=1`, async () => {
    const user = await desk();
    sendCode({ patientMrn: mrn, byUserId: user.userId, byUserName: user.name });
  });
}

export async function summaryAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/portal?mrn=${mrn}&sent=1`, async () => {
    const user = await desk();
    sendSummary({ patientMrn: mrn, byUserId: user.userId, byUserName: user.name });
  });
}

export async function proxyAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/portal?mrn=${mrn}`, async () => {
    const user = await desk();
    grantProxy({
      patientMrn: mrn,
      proxyName: String(formData.get("proxyName") ?? ""),
      proxyPhone: String(formData.get("proxyPhone") ?? ""),
      proxyIdNo: text(formData, "proxyIdNo"),
      relationship: String(formData.get("relationship") ?? ""),
      untilDate: String(formData.get("untilDate") ?? ""),
      patientConsented: formData.get("patientConsented") === "on",
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function revokeProxyAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act(`/portal?mrn=${mrn}`, async () => {
    const user = await desk();
    revokeProxy({
      proxyId: num(formData, "proxyId") ?? 0,
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

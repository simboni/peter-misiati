"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  registerAnalyser, mapTest, receiveMessage, resolveHeld,
  type Protocol,
} from "@/lib/analysers.ts";
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

/** The bench. Releasing is licence-gated elsewhere; taking a message is not. */
async function bench() {
  const user = await requireUser();
  requirePermission(user.userId, "lab.result.release", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

async function administrator() {
  const user = await requireUser();
  requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function receiveAction(formData: FormData): Promise<void> {
  const code = String(formData.get("analyserCode") ?? "");
  await act(`/analysers?a=${code}`, async () => {
    const user = await bench();
    receiveMessage({
      analyserCode: code,
      raw: String(formData.get("raw") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function resolveAction(formData: FormData): Promise<void> {
  await act("/analysers?view=held", async () => {
    const user = await bench();
    resolveHeld({
      exceptionId: num(formData, "exceptionId") ?? 0,
      specimenId: text(formData, "specimenId"),
      discardReason: text(formData, "discardReason"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function analyserAction(formData: FormData): Promise<void> {
  await act("/analysers?view=setup", async () => {
    const user = await administrator();
    registerAnalyser({
      facilityId: user.facilityId,
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
      protocol: (text(formData, "protocol") ?? "astm") as Protocol,
      make: text(formData, "make"),
      model: text(formData, "model"),
      connection: text(formData, "connection"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function mapAction(formData: FormData): Promise<void> {
  await act("/analysers?view=setup", async () => {
    await administrator();
    mapTest({
      analyserCode: String(formData.get("analyserCode") ?? ""),
      theirCode: String(formData.get("theirCode") ?? ""),
      analyte: String(formData.get("analyte") ?? ""),
      theirUnit: text(formData, "theirUnit"),
      factor: num(formData, "factor"),
    });
  });
}

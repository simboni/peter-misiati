"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { generateReturn, submitToDhis2, detectNotifiable, markNotified, type FormCode } from "@/lib/reporting.ts";
import { deviceFor } from "@/app/_components/device.ts";

export async function generateAction(formData: FormData): Promise<void> {
  await act("/reports", async () => {
    const user = await requireUser();
    generateReturn({
      facilityId: user.facilityId,
      form: String(formData.get("form") ?? "MOH717") as FormCode,
      period: String(formData.get("period") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function submitAction(formData: FormData): Promise<void> {
  await act("/reports", async () => {
    const user = await requireUser();
    submitToDhis2({
      facilityId: user.facilityId,
      form: String(formData.get("form") ?? "MOH717") as FormCode,
      period: String(formData.get("period") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function detectAction(): Promise<void> {
  await act("/reports", async () => {
    const user = await requireUser();
    detectNotifiable(user.facilityId);
  });
}

export async function notifyAction(formData: FormData): Promise<void> {
  await act("/reports", async () => {
    const user = await requireUser();
    markNotified({
      eventId: String(formData.get("eventId") ?? ""),
      reference: String(formData.get("reference") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

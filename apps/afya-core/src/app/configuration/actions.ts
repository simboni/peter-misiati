"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import { apply, reset, markReviewed } from "@/lib/configuration.ts";

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

async function administrator() {
  const user = await requireUser();
  requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function applyAction(formData: FormData): Promise<void> {
  await act("/configuration", async () => {
    const user = await administrator();
    apply({
      key: String(formData.get("key") ?? ""),
      value: String(formData.get("value") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      source: text(formData, "source"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function resetAction(formData: FormData): Promise<void> {
  await act("/configuration", async () => {
    const user = await administrator();
    reset({
      key: String(formData.get("key") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function reviewAction(formData: FormData): Promise<void> {
  await act("/configuration", async () => {
    const user = await administrator();
    markReviewed({
      key: String(formData.get("key") ?? ""),
      reviewerName: String(formData.get("reviewerName") ?? ""),
      reviewerRole: text(formData, "reviewerRole"),
      source: text(formData, "source"),
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

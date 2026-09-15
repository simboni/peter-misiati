"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { markActed, sweep } from "@/lib/notifications.ts";
import { acknowledgeResult } from "@/lib/orders.ts";

export async function actOnAction(formData: FormData): Promise<void> {
  await act("/notifications", async () => {
    const user = await requireUser();
    markActed({ id: Number(formData.get("id")), byUserId: user.userId, byUserName: user.name });
  });
}

export async function sweepAction(): Promise<void> {
  await act("/notifications", async () => {
    const user = await requireUser();
    sweep(user.facilityId);
  });
}

export async function acknowledgeAction(formData: FormData): Promise<void> {
  await act("/notifications", async () => {
    const user = await requireUser();
    acknowledgeResult({
      orderId: String(formData.get("orderId") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
      action: String(formData.get("action") ?? "").trim() || undefined,
    });
  });
}

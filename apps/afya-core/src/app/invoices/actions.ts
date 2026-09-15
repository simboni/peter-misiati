"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import { flushEtims } from "@/lib/billing.ts";

/** Send everything queued to KRA. Failures stay queued with the reason on them. */
export async function flushEtimsAction(): Promise<void> {
  await act("/invoices?view=etims", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "billing.charge", {
      actorName: user.name,
      facilityId: user.facilityId,
    });
    flushEtims();
  });
}

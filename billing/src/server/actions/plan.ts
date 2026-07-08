"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";

/**
 * A vendor requests the Pro (white-label) upgrade. This records the request;
 * a platform admin then activates the plan from the admin console. When real
 * subscription billing lands, this is where a checkout would start.
 */
export async function requestUpgradeAction(): Promise<void> {
  const { db, organizationId } = await requireOrg();
  await db
    .update(schema.orgProfile)
    .set({ planRequestedAt: new Date() })
    .where(eq(schema.orgProfile.organizationId, organizationId));
  revalidatePath("/upgrade");
  revalidatePath("/dashboard");
  revalidatePath("/admin/requests");
}

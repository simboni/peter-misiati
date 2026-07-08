"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { isPro } from "@/lib/plan";

/**
 * A vendor requests the Pro (white-label) upgrade. For the pilot this records
 * the request; the platform owner then activates the plan (see activatePlan).
 * When real subscription billing lands, this is where a checkout would start.
 */
export async function requestUpgradeAction(): Promise<void> {
  const { db, organizationId } = await requireOrg();
  await db
    .update(schema.orgProfile)
    .set({ planRequestedAt: new Date() })
    .where(eq(schema.orgProfile.organizationId, organizationId));
  revalidatePath("/upgrade");
  revalidatePath("/dashboard");
}

/**
 * Owner activation. Guarded by OWNER_EMAILS (comma-separated) so only the
 * platform operator can flip a workspace to Pro from inside the app. If
 * OWNER_EMAILS is unset this is a no-op — activate via the database instead
 * (see billing/README.md). Kept simple until real billing is wired.
 */
export async function activatePlanAction(fd: FormData): Promise<void> {
  const { db, organizationId, user } = await requireOrg();
  const owners = (process.env.OWNER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (owners.length === 0 || !owners.includes(user.email.toLowerCase())) return;

  const target = String(fd.get("plan") ?? "");
  const plan = isPro(target) ? "pro" : "free";
  await db
    .update(schema.orgProfile)
    .set({ plan, planRequestedAt: null })
    .where(eq(schema.orgProfile.organizationId, organizationId));
  revalidatePath("/upgrade");
  revalidatePath("/dashboard");
}

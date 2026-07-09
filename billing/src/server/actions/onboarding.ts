"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/server/auth";
import { getDb, schema } from "@/server/db";
import { seedSequences } from "@/server/sequence";
import { parseRate } from "@/server/money";

export type FormState = { error?: string };

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = crypto.randomUUID().slice(0, 6);
  return `${base || "workspace"}-${suffix}`;
}

export async function createOrganizationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Business name is required." };

  const legalName = String(formData.get("legalName") ?? "").trim() || null;
  const kraPin = String(formData.get("kraPin") ?? "").trim().toUpperCase() || null;
  const vatRegistered = formData.get("vatRegistered") === "on";
  const currency = String(formData.get("currency") ?? "KES").trim() || "KES";
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const defaultVatRateBps = vatRegistered ? parseRate(formData.get("vatRate") ?? "16") : 0;

  const auth = await getAuth();
  const hdrs = await headers();

  let organizationId: string;
  try {
    const org = await auth.api.createOrganization({
      body: { name, slug: slugify(name) },
      headers: hdrs,
    });
    if (!org?.id) return { error: "Could not create your workspace. Please try again." };
    organizationId = org.id;
    await auth.api.setActiveOrganization({ body: { organizationId }, headers: hdrs });
  } catch (e) {
    const msg =
      e && typeof e === "object" && "body" in e
        ? ((e as { body?: { message?: string } }).body?.message ?? null)
        : null;
    return { error: msg ?? "Could not create your workspace. Please try again." };
  }

  const db = await getDb();
  await db.insert(schema.orgProfile).values({
    organizationId,
    legalName,
    kraPin,
    vatRegistered,
    defaultVatRateBps,
    currency,
    email,
    phone,
    addressLine1,
    city,
    country: "Kenya",
    // New workspaces start on Pro (white-label). An admin can switch a vendor
    // back to Free (or re-activate Pro) from Admin → Vendors at any time.
    plan: "pro",
    planActivatedAt: new Date(),
  });
  await seedSequences(db, organizationId);

  redirect("/dashboard");
}

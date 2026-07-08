"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { parseRate } from "@/server/money";

export type FormState = { error?: string; ok?: boolean };

function str(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
}

export async function saveSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();

  const name = str(fd, "name");
  if (!name) return { error: "Business name is required." };

  const vatRegistered = fd.get("vatRegistered") === "on";

  await db
    .update(schema.organization)
    .set({ name })
    .where(eq(schema.organization.id, organizationId));

  await db
    .update(schema.orgProfile)
    .set({
      legalName: str(fd, "legalName"),
      kraPin: str(fd, "kraPin")?.toUpperCase() ?? null,
      vatRegistered,
      defaultVatRateBps: vatRegistered ? parseRate(fd.get("vatRate") ?? "16") : 0,
      currency: str(fd, "currency") ?? "KES",
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      addressLine1: str(fd, "addressLine1"),
      addressLine2: str(fd, "addressLine2"),
      city: str(fd, "city"),
      country: str(fd, "country") ?? "Kenya",
      logoUrl: str(fd, "logoUrl"),
      bankDetails: str(fd, "bankDetails"),
      invoiceFooter: str(fd, "invoiceFooter"),
      invoiceTemplate: str(fd, "invoiceTemplate") ?? "column",
      accentColor: str(fd, "accentColor") ?? "#0e9f6e",
      signatureUrl: str(fd, "signatureUrl"),
      signatureName: str(fd, "signatureName"),
      signatureTitle: str(fd, "signatureTitle"),
      signatureAlign: ["left", "center", "right"].includes(String(fd.get("signatureAlign")))
        ? String(fd.get("signatureAlign"))
        : "right",
      showSignature: fd.get("showSignature") === "on",
    })
    .where(eq(schema.orgProfile.organizationId, organizationId));

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

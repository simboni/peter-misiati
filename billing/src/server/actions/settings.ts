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

// Accept only a raster-image data URL or an absolute https URL for logo/
// signature. Rejecting text/html, image/svg+xml and other schemes here (not
// just client-side) stops a direct Server Action POST from storing an
// executable "image" that the public /d/[token]/logo route would serve from
// our origin. Anything invalid is dropped to null rather than trusted.
function imageUrl(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  if (!v) return null;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(v)) return v;
  if (/^https:\/\/[^\s]+$/i.test(v)) return v;
  return null;
}

// A CSS colour we control: #rgb / #rrggbb(aa) only. Prevents url()/expression
// injection into the inline style that consumes accentColor.
function hexColor(fd: FormData, key: string, fallback: string): string {
  const v = str(fd, key);
  return v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
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
      logoUrl: imageUrl(fd, "logoUrl"),
      bankDetails: str(fd, "bankDetails"),
      invoiceFooter: str(fd, "invoiceFooter"),
      invoiceTemplate: str(fd, "invoiceTemplate") ?? "column",
      accentColor: hexColor(fd, "accentColor", "#0e9f6e"),
      signatureUrl: imageUrl(fd, "signatureUrl"),
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

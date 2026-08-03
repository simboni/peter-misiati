"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { schema } from "@/server/db";
import { requireAdmin, requireSuperAdmin, audit } from "@/server/admin";
import { getPlatformSettings } from "@/server/platform";
import { appSecret } from "@/server/config";
import { encryptSecret } from "@/server/crypto";

const orgName = async (db: Awaited<ReturnType<typeof requireAdmin>>["db"], orgId: string) => {
  const r = await db.select({ name: schema.organization.name }).from(schema.organization).where(eq(schema.organization.id, orgId)).limit(1);
  return r[0]?.name ?? orgId;
};

function revalidateAdmin() {
  revalidatePath("/admin");
  revalidatePath("/admin/vendors");
  revalidatePath("/admin/requests");
  revalidatePath("/admin/users");
  revalidatePath("/admin/audit");
}

/** Activate or revert a vendor's plan. Any admin can do this. */
export async function setVendorPlanAction(fd: FormData): Promise<void> {
  const { db, user } = await requireAdmin();
  const orgId = String(fd.get("orgId") ?? "");
  const plan = String(fd.get("plan") ?? "") === "pro" ? "pro" : "free";
  if (!orgId) return;
  await db
    .update(schema.orgProfile)
    .set({
      plan,
      planActivatedAt: plan === "pro" ? new Date() : null,
      planRequestedAt: null,
    })
    .where(eq(schema.orgProfile.organizationId, orgId));
  await audit(db, user, plan === "pro" ? "plan.activate" : "plan.revert", {
    targetType: "organization",
    targetId: orgId,
    targetLabel: await orgName(db, orgId),
    detail: `Plan set to ${plan}`,
  });
  revalidateAdmin();
  revalidatePath(`/admin/vendors/${orgId}`);
}

/** Suspend / restore a workspace. */
export async function setVendorSuspendedAction(fd: FormData): Promise<void> {
  const { db, user } = await requireAdmin();
  const orgId = String(fd.get("orgId") ?? "");
  const suspended = String(fd.get("suspended") ?? "") === "true";
  if (!orgId) return;
  await db.update(schema.orgProfile).set({ suspended }).where(eq(schema.orgProfile.organizationId, orgId));
  await audit(db, user, suspended ? "vendor.suspend" : "vendor.restore", {
    targetType: "organization",
    targetId: orgId,
    targetLabel: await orgName(db, orgId),
  });
  revalidateAdmin();
  revalidatePath(`/admin/vendors/${orgId}`);
}

/** Set (or clear) a custom per-seat price for a vendor. Money change → super only. */
export async function setVendorPriceOverrideAction(fd: FormData): Promise<void> {
  const { db, user } = await requireSuperAdmin();
  const orgId = String(fd.get("orgId") ?? "");
  const raw = String(fd.get("price") ?? "").trim();
  if (!orgId) return;
  const price = raw === "" ? null : Math.max(0, Math.round(Number(raw)));
  await db
    .update(schema.orgProfile)
    .set({ planPriceOverrideKes: Number.isFinite(price as number) ? price : null })
    .where(eq(schema.orgProfile.organizationId, orgId));
  await audit(db, user, "vendor.price_override", {
    targetType: "organization",
    targetId: orgId,
    targetLabel: await orgName(db, orgId),
    detail: price == null ? "Cleared price override" : `Per-seat price → KES ${price}`,
  });
  revalidatePath(`/admin/vendors/${orgId}`);
}

/** Save an internal admin note on a vendor. */
export async function saveVendorNoteAction(fd: FormData): Promise<void> {
  const { db, user } = await requireAdmin();
  const orgId = String(fd.get("orgId") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;
  if (!orgId) return;
  await db.update(schema.orgProfile).set({ adminNote: note }).where(eq(schema.orgProfile.organizationId, orgId));
  await audit(db, user, "vendor.note", { targetType: "organization", targetId: orgId, targetLabel: await orgName(db, orgId) });
  revalidatePath(`/admin/vendors/${orgId}`);
}

/** Grant / revoke platform admin or super-admin. Super-admin only. */
export async function setUserRoleAction(fd: FormData): Promise<void> {
  const { db, user } = await requireSuperAdmin();
  const userId = String(fd.get("userId") ?? "");
  const role = String(fd.get("role") ?? ""); // super | admin | none
  if (!userId) return;

  const targetRows = await db.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  const target = targetRows[0];
  if (!target) return;

  // Never allow removing the last super-admin (lockout guard).
  if (target.isSuperAdmin && role !== "super") {
    const others = await db
      .select({ c: schema.user.id })
      .from(schema.user)
      .where(and(eq(schema.user.isSuperAdmin, true), ne(schema.user.id, userId)));
    if (others.length === 0) return;
  }

  const isSuper = role === "super";
  const isAdmin = role === "super" || role === "admin";
  await db
    .update(schema.user)
    .set({ isSuperAdmin: isSuper, isPlatformAdmin: isAdmin, updatedAt: new Date() })
    .where(eq(schema.user.id, userId));
  await audit(db, user, "admin.role", {
    targetType: "user",
    targetId: userId,
    targetLabel: target.email,
    detail: `Role → ${role}`,
  });
  revalidatePath("/admin/users");
}

/** Disable / enable a user account. Super-admin only; can't disable yourself. */
export async function setUserDisabledAction(fd: FormData): Promise<void> {
  const { db, user } = await requireSuperAdmin();
  const userId = String(fd.get("userId") ?? "");
  const disabled = String(fd.get("disabled") ?? "") === "true";
  if (!userId || userId === user.id) return;
  const t = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  await db.update(schema.user).set({ disabled, updatedAt: new Date() }).where(eq(schema.user.id, userId));
  await audit(db, user, disabled ? "user.disable" : "user.enable", { targetType: "user", targetId: userId, targetLabel: t[0]?.email });
  revalidatePath("/admin/users");
}

export type SettingsState = { ok?: boolean; error?: string };

/** Save platform settings (pricing, platform M-Pesa, email). Super-admin only. */
export async function savePlatformSettingsAction(_prev: SettingsState, fd: FormData): Promise<SettingsState> {
  const { db, user } = await requireSuperAdmin();
  const current = await getPlatformSettings(db);
  const secret = await appSecret();

  const num = (k: string, d: number) => {
    const v = Number(String(fd.get(k) ?? "").trim());
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : d;
  };
  const str = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? null : v;
  };

  // Secrets: only overwrite when a new value is typed (blank = keep existing).
  const newClientSecret = str("kopokopoClientSecret");
  const newApiKey = str("kopokopoApiKey");
  const newResendKey = str("resendApiKey");

  await db
    .update(schema.platformSettings)
    .set({
      pricePerSeatKes: num("pricePerSeatKes", current.pricePerSeatKes),
      currency: str("currency") ?? current.currency,
      kopokopoEnabled: fd.get("kopokopoEnabled") === "on",
      kopokopoBaseUrl: str("kopokopoBaseUrl"),
      kopokopoTill: str("kopokopoTill"),
      kopokopoClientId: str("kopokopoClientId"),
      kopokopoClientSecretEnc: newClientSecret
        ? await encryptSecret(newClientSecret, secret)
        : current.kopokopoClientSecretEnc,
      kopokopoApiKeyEnc: newApiKey ? await encryptSecret(newApiKey, secret) : current.kopokopoApiKeyEnc,
      resendApiKeyEnc: newResendKey ? await encryptSecret(newResendKey, secret) : current.resendApiKeyEnc,
      resendFrom: str("resendFrom"),
      updatedAt: new Date(),
    })
    .where(eq(schema.platformSettings.id, current.id));

  await audit(db, user, "config.update", { targetType: "settings", detail: "Updated platform settings" });
  revalidatePath("/admin/settings");
  return { ok: true };
}

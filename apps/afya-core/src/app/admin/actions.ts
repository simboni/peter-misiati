"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import { setIdentifiers, registerDevice, revokeDevice, setSetting } from "@/lib/facility.ts";
import { createUser, setActive, recordLicence } from "@/lib/users.ts";
import { setEndpointMode, resolveDeadLetter, type EndpointMode } from "@/lib/integration.ts";
import { setTariff } from "@/lib/billing.ts";

export async function identifiersAction(formData: FormData): Promise<void> {
  await act("/admin", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
    setIdentifiers({
      facilityId: user.facilityId,
      shaProviderCode: String(formData.get("sha") ?? "").trim() || undefined,
      kraPin: String(formData.get("kra") ?? "").trim() || undefined,
      odpcRegistration: String(formData.get("odpc") ?? "").trim() || undefined,
      odpcExpiresOn: String(formData.get("odpcExpires") ?? "").trim() || undefined,
      county: String(formData.get("county") ?? "").trim() || undefined,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function deviceAction(formData: FormData): Promise<void> {
  await act("/admin", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "device.manage", { actorName: user.name, facilityId: user.facilityId });
    registerDevice({
      facilityId: user.facilityId,
      code: String(formData.get("code") ?? ""),
      label: String(formData.get("label") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function revokeDeviceAction(formData: FormData): Promise<void> {
  await act("/admin", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "device.manage", { actorName: user.name, facilityId: user.facilityId });
    revokeDevice({
      code: String(formData.get("code") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function userAction(formData: FormData): Promise<void> {
  await act("/admin", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "user.manage", { actorName: user.name, facilityId: user.facilityId });

    const id = createUser({
      facilityId: user.facilityId,
      name: String(formData.get("name") ?? ""),
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
      cadreCode: String(formData.get("cadre") ?? "administrative"),
      roles: [String(formData.get("role") ?? "receptionist")],
      mustChangePassword: true,
      byUserId: user.userId,
      byUserName: user.name,
    });

    const licence = String(formData.get("licence") ?? "").trim();
    const expires = String(formData.get("licenceExpires") ?? "").trim();
    if (licence && expires) {
      recordLicence({
        userId: id,
        regulator: String(formData.get("regulator") ?? "KMPDC"),
        licenceNumber: licence,
        expiresOn: expires,
        byUserId: user.userId,
        byUserName: user.name,
      });
    }
  });
}

export async function toggleUserAction(formData: FormData): Promise<void> {
  await act("/admin", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "user.manage", { actorName: user.name, facilityId: user.facilityId });
    setActive({
      userId: Number(formData.get("userId")),
      active: String(formData.get("active")) === "1",
      reason: String(formData.get("reason") ?? "").trim() || undefined,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function endpointModeAction(formData: FormData): Promise<void> {
  await act("/admin", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
    setEndpointMode({
      code: String(formData.get("code") ?? ""),
      mode: String(formData.get("mode") ?? "demo") as EndpointMode,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function resolveDeadLetterAction(formData: FormData): Promise<void> {
  await act("/admin", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
    resolveDeadLetter(Number(formData.get("id")), user.userId);
  });
}

export async function tariffAction(formData: FormData): Promise<void> {
  await act("/admin", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "tariff.manage", { actorName: user.name, facilityId: user.facilityId });
    setTariff({
      payerCode: String(formData.get("payerCode") ?? "CASH"),
      serviceCode: String(formData.get("serviceCode") ?? ""),
      priceCents: Math.round(Number(formData.get("price") ?? 0) * 100),
      effectiveFrom: String(formData.get("from") ?? "").trim() || undefined,
      source: String(formData.get("source") ?? ""),
    });
  });
}

export async function settingAction(formData: FormData): Promise<void> {
  await act("/admin", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
    setSetting(String(formData.get("key") ?? ""), String(formData.get("value") ?? ""), {
      userId: user.userId,
      name: user.name,
    });
  });
}

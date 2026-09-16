"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  addAsset, setAssetStatus, scheduleMaintenance, recordMaintenance,
  reportFault, closeWorkOrder, recordTemperature, postDepreciation,
  type AssetCategory, type AssetStatus, type ScheduleKind, type WorkOrderStatus,
} from "@/lib/assets.ts";
import { deviceFor } from "@/app/_components/device.ts";

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

function num(formData: FormData, key: string): number | undefined {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Money is typed in shillings and held in cents. */
function cents(formData: FormData, key: string): number | undefined {
  const shillings = num(formData, key);
  return shillings === undefined ? undefined : Math.round(shillings * 100);
}

/** Anyone who can see the board can record against it. */
async function keeper() {
  const user = await requireUser();
  requirePermission(user.userId, "report.read", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

/** Changing the register itself is a facility configuration act. */
async function estates() {
  const user = await requireUser();
  requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function addAssetAction(formData: FormData): Promise<void> {
  await act("/assets?view=register", async () => {
    const user = await estates();
    addAsset({
      facilityId: user.facilityId,
      tag: String(formData.get("tag") ?? ""),
      name: String(formData.get("name") ?? ""),
      category: (text(formData, "category") ?? "equipment") as AssetCategory,
      location: text(formData, "location"),
      storeCode: text(formData, "storeCode"),
      serialNo: text(formData, "serialNo"),
      manufacturer: text(formData, "manufacturer"),
      model: text(formData, "model"),
      critical: formData.get("critical") === "on",
      acquiredOn: text(formData, "acquiredOn"),
      costCents: cents(formData, "cost"),
      usefulLifeMonths: num(formData, "usefulLifeMonths"),
      supplierCode: text(formData, "supplierCode"),
      warrantyUntil: text(formData, "warrantyUntil"),
      serviceContract: text(formData, "serviceContract"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function statusAction(formData: FormData): Promise<void> {
  const assetId = String(formData.get("assetId") ?? "");
  await act(`/assets?view=register&a=${assetId}`, async () => {
    const user = await estates();
    setAssetStatus({
      assetId,
      status: (text(formData, "status") ?? "in_service") as AssetStatus,
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function scheduleAction(formData: FormData): Promise<void> {
  const assetId = String(formData.get("assetId") ?? "");
  await act(`/assets?view=register&a=${assetId}`, async () => {
    const user = await estates();
    scheduleMaintenance({
      assetId,
      kind: (text(formData, "kind") ?? "service") as ScheduleKind,
      name: String(formData.get("name") ?? ""),
      everyDays: num(formData, "everyDays") ?? 0,
      regulator: text(formData, "regulator"),
      blocksUse: formData.get("blocksUse") === "on",
      lastDoneOn: text(formData, "lastDoneOn"),
      note: text(formData, "note"),
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function maintenanceAction(formData: FormData): Promise<void> {
  const assetId = String(formData.get("assetId") ?? "");
  await act(`/assets?view=register&a=${assetId}`, async () => {
    const user = await keeper();
    recordMaintenance({
      assetId,
      scheduleId: text(formData, "scheduleId"),
      kind: (text(formData, "kind") ?? "service") as ScheduleKind,
      doneOn: text(formData, "doneOn"),
      // The default is the safe one: a check is only passed if somebody says so.
      passed: formData.get("outcome") !== "failed",
      findings: text(formData, "findings"),
      certificate: text(formData, "certificate"),
      performedBy: text(formData, "performedBy"),
      costCents: cents(formData, "cost"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function faultAction(formData: FormData): Promise<void> {
  const assetId = String(formData.get("assetId") ?? "");
  await act(`/assets?view=register&a=${assetId}`, async () => {
    const user = await keeper();
    reportFault({
      assetId,
      fault: String(formData.get("fault") ?? ""),
      // Down unless the reporter says it is still usable — which is the way
      // round that errs towards not using broken equipment.
      outOfService: formData.get("stillUsable") !== "on",
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function closeFaultAction(formData: FormData): Promise<void> {
  await act("/assets?view=faults", async () => {
    const user = await keeper();
    closeWorkOrder({
      workOrderId: String(formData.get("workOrderId") ?? ""),
      status: (text(formData, "status") ?? "fixed") as Extract<
        WorkOrderStatus,
        "fixed" | "beyond_repair" | "cancelled"
      >,
      resolution: String(formData.get("resolution") ?? ""),
      costCents: cents(formData, "cost"),
      assignedTo: text(formData, "assignedTo"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function temperatureAction(formData: FormData): Promise<void> {
  await act("/assets?view=cold", async () => {
    const user = await keeper();
    const degrees = num(formData, "degrees");
    recordTemperature({
      assetId: String(formData.get("assetId") ?? ""),
      // Typed in degrees to one decimal, held in tenths.
      readingTenths: Math.round((degrees ?? 0) * 10),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function depreciationAction(formData: FormData): Promise<void> {
  await act("/assets?view=value", async () => {
    const user = await estates();
    postDepreciation({
      facilityId: user.facilityId,
      period: String(formData.get("period") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

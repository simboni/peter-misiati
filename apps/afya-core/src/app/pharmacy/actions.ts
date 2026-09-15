"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { dispense } from "@/lib/pharmacy.ts";
import { receiveStock } from "@/lib/inventory.ts";
import { deviceFor } from "@/app/_components/device.ts";

export async function dispenseAction(formData: FormData): Promise<void> {
  await act("/pharmacy", async () => {
    const user = await requireUser();
    const substitute = String(formData.get("productCode") ?? "").trim();

    dispense({
      prescriptionId: String(formData.get("prescriptionId") ?? ""),
      storeCode: String(formData.get("storeCode") ?? "PHARM"),
      // Blank means "everything outstanding that stock allows", which is what a
      // pharmacist means when they do not type a number.
      quantity: String(formData.get("quantity") ?? "").trim()
        ? Number(formData.get("quantity"))
        : undefined,
      productCode: substitute || undefined,
      substitutionReason: String(formData.get("substitutionReason") ?? "").trim() || undefined,
      counselling: String(formData.get("counselling") ?? "").trim() || undefined,
      payerCode: String(formData.get("payerCode") ?? "CASH"),
      dispenserId: user.userId,
      dispenserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });

  });
}

export async function receiveStockAction(formData: FormData): Promise<void> {
  await act("/stock", async () => {
    const user = await requireUser();
    receiveStock({
      storeCode: String(formData.get("storeCode") ?? "PHARM"),
      productCode: String(formData.get("productCode") ?? ""),
      batchNumber: String(formData.get("batchNumber") ?? ""),
      expiresOn: String(formData.get("expiresOn") ?? ""),
      quantity: Number(formData.get("quantity") ?? 0),
      unitCostCents: Math.round(Number(formData.get("unitCost") ?? 0) * 100),
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

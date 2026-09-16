"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  raiseRequisition, decideRequisition, recordQuotation, selectQuotation,
  issuePurchaseOrder, cancelPurchaseOrder, receiveDelivery, recordInvoice,
  runMatch, approveInvoice, payInvoice, defineSupplier, blockSupplier,
  poLines, type AgpoCategory,
} from "@/lib/procurement.ts";
import { deviceFor } from "@/app/_components/device.ts";

function num(formData: FormData, key: string): number | undefined {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

/** Shillings on a form, cents everywhere else. */
function cents(formData: FormData, key: string): number | undefined {
  const value = num(formData, key);
  return value === undefined ? undefined : Math.round(value * 100);
}

async function buyer() {
  const user = await requireUser();
  requirePermission(user.userId, "report.read", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function requisitionAction(formData: FormData): Promise<void> {
  await act("/procurement", async () => {
    const user = await buyer();
    // Up to four lines on the form; the module itself takes any number.
    const lines: { productCode: string; quantity: number }[] = [];
    for (const n of [1, 2, 3, 4]) {
      const code = text(formData, `productCode${n}`);
      const quantity = num(formData, `quantity${n}`);
      if (code && quantity) lines.push({ productCode: code, quantity });
    }
    raiseRequisition({
      facilityId: user.facilityId,
      storeCode: String(formData.get("storeCode") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      lines,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function decideAction(formData: FormData): Promise<void> {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  await act(`/procurement?r=${requisitionId}`, async () => {
    const user = await buyer();
    decideRequisition({
      requisitionId,
      approve: formData.get("decision") === "approve",
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function quotationAction(formData: FormData): Promise<void> {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  await act(`/procurement?r=${requisitionId}`, async () => {
    const user = await buyer();
    recordQuotation({
      requisitionId,
      supplierCode: String(formData.get("supplierCode") ?? ""),
      totalCents: cents(formData, "total") ?? 0,
      leadDays: num(formData, "leadDays"),
      note: text(formData, "note"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function selectAction(formData: FormData): Promise<void> {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  await act(`/procurement?r=${requisitionId}`, async () => {
    const user = await buyer();
    selectQuotation({
      requisitionId,
      supplierCode: String(formData.get("supplierCode") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function orderAction(formData: FormData): Promise<void> {
  await act("/procurement?view=orders", async () => {
    const user = await buyer();
    const lines: { productCode: string; quantity: number; unitCostCents: number }[] = [];
    for (const n of [1, 2, 3, 4]) {
      const code = text(formData, `productCode${n}`);
      const quantity = num(formData, `quantity${n}`);
      const price = cents(formData, `unitCost${n}`);
      if (code && quantity && price !== undefined) {
        lines.push({ productCode: code, quantity, unitCostCents: price });
      }
    }
    issuePurchaseOrder({
      facilityId: user.facilityId,
      supplierCode: String(formData.get("supplierCode") ?? ""),
      storeCode: String(formData.get("storeCode") ?? ""),
      requisitionId: text(formData, "requisitionId"),
      expectedOn: text(formData, "expectedOn"),
      lines,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function cancelOrderAction(formData: FormData): Promise<void> {
  await act("/procurement?view=orders", async () => {
    const user = await buyer();
    cancelPurchaseOrder({
      poId: String(formData.get("poId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function receiveAction(formData: FormData): Promise<void> {
  const poId = String(formData.get("poId") ?? "");
  await act(`/procurement?view=orders&p=${poId}`, async () => {
    const user = await buyer();
    // One row per ordered line, keyed by product code so the form matches the
    // order rather than the other way round.
    const lines: Parameters<typeof receiveDelivery>[0]["lines"] = [];
    for (const line of poLines(poId)) {
      const quantity = num(formData, `qty_${line.product_code}`);
      if (quantity === undefined) continue;
      lines.push({
        productCode: line.product_code,
        quantity,
        batchNumber: String(formData.get(`batch_${line.product_code}`) ?? ""),
        expiresOn: String(formData.get(`expiry_${line.product_code}`) ?? ""),
        rejected: num(formData, `rejected_${line.product_code}`),
        rejectReason: text(formData, `rejectReason_${line.product_code}`),
      });
    }
    receiveDelivery({
      poId,
      deliveryNote: text(formData, "deliveryNote"),
      note: text(formData, "note"),
      lines,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function invoiceAction(formData: FormData): Promise<void> {
  const poId = String(formData.get("poId") ?? "");
  await act(`/procurement?view=invoices`, async () => {
    const user = await buyer();
    const lines: { productCode: string; quantity: number; unitCostCents: number }[] = [];
    for (const line of poLines(poId)) {
      const quantity = num(formData, `iqty_${line.product_code}`);
      const price = cents(formData, `iprice_${line.product_code}`);
      if (quantity !== undefined && price !== undefined) {
        lines.push({ productCode: line.product_code, quantity, unitCostCents: price });
      }
    }
    const invoiceId = recordInvoice({
      poId,
      invoiceNo: String(formData.get("invoiceNo") ?? ""),
      invoiceDate: String(formData.get("invoiceDate") ?? ""),
      etimsNumber: text(formData, "etimsNumber"),
      lines,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
    // Match it straight away: an invoice nobody matched is the thing this
    // module exists to prevent.
    runMatch({ invoiceId, facilityId: user.facilityId, byUserId: user.userId, byUserName: user.name });
  });
}

export async function matchAction(formData: FormData): Promise<void> {
  await act("/procurement?view=invoices", async () => {
    const user = await buyer();
    runMatch({
      invoiceId: String(formData.get("invoiceId") ?? ""),
      facilityId: user.facilityId,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function approveInvoiceAction(formData: FormData): Promise<void> {
  await act("/procurement?view=invoices", async () => {
    const user = await buyer();
    approveInvoice({
      invoiceId: String(formData.get("invoiceId") ?? ""),
      overrideReason: text(formData, "overrideReason"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function payAction(formData: FormData): Promise<void> {
  await act("/procurement?view=invoices", async () => {
    const user = await buyer();
    payInvoice({
      invoiceId: String(formData.get("invoiceId") ?? ""),
      paymentRef: String(formData.get("paymentRef") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function supplierAction(formData: FormData): Promise<void> {
  await act("/procurement?view=suppliers", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
    defineSupplier({
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
      kraPin: text(formData, "kraPin"),
      ppbLicence: text(formData, "ppbLicence"),
      ppbExpiresOn: text(formData, "ppbExpiresOn"),
      agpoCategory: (text(formData, "agpoCategory") ?? "none") as AgpoCategory,
      agpoCertificate: text(formData, "agpoCertificate"),
      phone: text(formData, "phone"),
    });
  });
}

export async function blockAction(formData: FormData): Promise<void> {
  await act("/procurement?view=suppliers", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
    blockSupplier({
      code: String(formData.get("code") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

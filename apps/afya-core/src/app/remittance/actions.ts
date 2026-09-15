"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import { importRemittance, reconcile, matchByHand, disputeLine, type AdviceLine } from "@/lib/remittance.ts";
import { deviceFor } from "@/app/_components/device.ts";

function toCents(raw: string): number {
  const value = raw.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error(`"${raw}" is not an amount.`);
  return Math.round(Number(value) * 100);
}

/**
 * Import an advice pasted from the payer's portal.
 *
 * A payer sends a PDF or a spreadsheet, and a claims officer has it on screen
 * already. Pasting beats an upload parser that has to guess at four different
 * payer formats and silently mis-reads one of them.
 *
 * One line per row: reference, amount, and optionally a reason code and reason,
 * separated by commas or tabs.
 */
export async function importAction(formData: FormData): Promise<void> {
  await act("/remittance", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "claim.prepare", {
      actorName: user.name,
      facilityId: user.facilityId,
    });

    const raw = String(formData.get("lines") ?? "").trim();
    if (!raw) throw new Error("Paste the advice lines — one claim per row.");

    const lines: AdviceLine[] = raw.split(/\r?\n/).filter((l) => l.trim()).map((row, i) => {
      const parts = row.split(/[\t,]/).map((c) => c.trim());
      if (parts.length < 2) {
        throw new Error(`Row ${i + 1} ("${row}") needs at least a reference and an amount.`);
      }
      return {
        payerReference: parts[0],
        paidCents: toCents(parts[1]),
        claimedCents: parts[2] ? toCents(parts[2]) : undefined,
        reasonCode: parts[3] || undefined,
        reason: parts.slice(4).join(", ") || undefined,
      };
    });

    importRemittance({
      facilityId: user.facilityId,
      payerCode: String(formData.get("payerCode") ?? "SHA"),
      reference: String(formData.get("reference") ?? ""),
      adviceDate: String(formData.get("adviceDate") ?? ""),
      statedTotalCents: toCents(String(formData.get("statedTotal") ?? "0")),
      lines,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function reconcileAction(formData: FormData): Promise<void> {
  const id = String(formData.get("remittanceId") ?? "");
  await act(`/remittance?advice=${encodeURIComponent(id)}`, async () => {
    const user = await requireUser();
    requirePermission(user.userId, "claim.prepare", { actorName: user.name, facilityId: user.facilityId });
    reconcile({ remittanceId: id, byUserId: user.userId, byUserName: user.name });
  });
}

export async function matchAction(formData: FormData): Promise<void> {
  const advice = String(formData.get("remittanceId") ?? "");
  await act(`/remittance?advice=${encodeURIComponent(advice)}`, async () => {
    const user = await requireUser();
    matchByHand({
      lineId: Number(formData.get("lineId")),
      claimId: String(formData.get("claimId") ?? "").trim().toUpperCase(),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function disputeAction(formData: FormData): Promise<void> {
  const advice = String(formData.get("remittanceId") ?? "");
  await act(`/remittance?advice=${encodeURIComponent(advice)}`, async () => {
    const user = await requireUser();
    disputeLine({
      lineId: Number(formData.get("lineId")),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

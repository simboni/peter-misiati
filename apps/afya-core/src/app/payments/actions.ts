"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import { recordPayment, refundPayment } from "@/lib/billing.ts";
import { call } from "@/lib/integration.ts";
import { deviceFor } from "@/app/_components/device.ts";

/** KES typed by a cashier, as integer cents. Never a float anywhere near money. */
function toCents(raw: FormDataEntryValue | null): number {
  const value = String(raw ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error(`"${value}" is not an amount. Type it as shillings, e.g. 450 or 450.50.`);
  }
  return Math.round(Number(value) * 100);
}

export async function takePaymentAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  // Back to the invoice, not the list: the cashier has to read the M-Pesa code
  // off the screen to the patient, and a settled invoice leaves the list.
  await act(`/payments?invoice=${encodeURIComponent(invoiceId)}`, async () => {
    const user = await requireUser();
    requirePermission(user.userId, "payment.receive", {
      actorName: user.name,
      facilityId: user.facilityId,
    });

    const method = String(formData.get("method") ?? "cash") as
      | "cash" | "mpesa" | "card" | "cheque" | "insurance" | "waiver";
    const amountCents = toCents(formData.get("amount"));
    let reference = String(formData.get("reference") ?? "").trim();

    // M-Pesa goes out through the hub like everything else, so a demonstration
    // records a simulated confirmation and a real deployment records a real
    // one — and the log says which. A failed request never becomes a receipt.
    if (method === "mpesa") {
      const phone = String(formData.get("phone") ?? "").trim();
      const result = call({
        endpoint: "MPESA",
        operation: "requestPayment",
        request: { phone, amountCents, account: invoiceId },
      });
      if (!result.ok) throw new Error(result.error);
      reference = typeof result.data.receipt === "string" ? result.data.receipt : reference;
    }

    recordPayment({
      invoiceId,
      method,
      amountCents,
      reference,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function refundAction(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  await act(invoiceId ? `/payments?invoice=${encodeURIComponent(invoiceId)}` : "/payments", async () => {
    const user = await requireUser();
    const amount = String(formData.get("amount") ?? "").trim();
    refundPayment({
      paymentId: String(formData.get("paymentId") ?? ""),
      // Blank means all of what is left, which is what a cashier means when
      // they do not type a number.
      amountCents: amount ? toCents(formData.get("amount")) : undefined,
      reason: String(formData.get("reason") ?? ""),
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

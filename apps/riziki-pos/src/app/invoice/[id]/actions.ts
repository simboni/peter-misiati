"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { payInvoice, type PaymentMethod } from "@/lib/credit";
import { toCents } from "@/lib/units";

export interface PayState {
  error?: string;
}

/**
 * Take money against this invoice.
 *
 * `requireUser()` first, because a Server Action is reachable by a direct POST
 * and not only through the button we drew.
 */
export async function payInvoiceAction(_prev: PayState, formData: FormData): Promise<PayState> {
  const user = await requireUser();

  let paid = 0;
  let saleIdForRedirect = 0;

  try {
    const saleId = Number(formData.get("sale_id"));
    if (!Number.isInteger(saleId)) return { error: "Which invoice? Reload and try again." };

    const raw = String(formData.get("amount") ?? "").trim().replace(/,/g, "");
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value <= 0) {
      return { error: "Enter the amount received." };
    }

    const method = String(formData.get("method") ?? "cash") as PaymentMethod;
    const code = String(formData.get("mpesa_code") ?? "").trim().toUpperCase();
    if (method === "mpesa" && !code) {
      return { error: "An M-Pesa payment needs its code, so it can be reconciled later." };
    }

    const res = payInvoice({
      saleId,
      amountCents: toCents(value),
      method,
      mpesaCode: method === "mpesa" ? code : null,
      userId: user.id,
    });

    // Every screen that shows this money: the bill, the customer, and the two
    // wholesale lists that total it.
    revalidatePath(`/invoice/${saleId}`);
    revalidatePath("/customers");
    revalidatePath("/wholesale");
    revalidatePath("/wholesale/invoices");
    revalidatePath("/wholesale/customers");

    paid = res.appliedCents;
    saleIdForRedirect = saleId;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong. Please try again." };
  }

  /*
    The confirmation is a redirect rather than a value handed back to the form,
    because paying a bill in full removes the form: `collecting` goes false and
    the panel unmounts, taking any message it was holding with it. Somebody who
    has just settled an invoice would see the panel silently vanish and have no
    idea whether the money landed.

    Redirecting re-renders the page with the new figures *and* a banner that
    does not depend on the form still being there. It also sits outside the
    try/catch on purpose: `redirect()` works by throwing, and the catch above
    would otherwise swallow it and report it as a failure.
  */
  redirect(`/invoice/${saleIdForRedirect}?paid=${paid}`);
}

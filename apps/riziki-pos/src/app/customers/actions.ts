"use server";

/**
 * Server actions for the debtors screens.
 *
 * Every one of these starts with `requireUser()`. Server Actions are reachable
 * by a direct POST, not only through our own buttons, so the guard has to live
 * here rather than in the page that renders the form.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createCustomer, updateCustomer, recordPayment, type CustomerKind, type PaymentMethod } from "@/lib/credit";
import { toCents } from "@/lib/units";

export interface FormState {
  error?: string;
  ok?: string;
}

/** The shop types shillings; the database only ever sees integer cents. */
function centsFromField(raw: FormDataEntryValue | null, label: string): number {
  const text = String(raw ?? "").trim().replace(/,/g, "");
  if (!text) return 0;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a number, zero or more.`);
  return toCents(value);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

export async function saveCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();

  try {
    const idRaw = String(formData.get("id") ?? "").trim();
    const input = {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      kind: (String(formData.get("kind") ?? "retail") as CustomerKind),
      creditLimitCents: centsFromField(formData.get("credit_limit"), "The credit limit"),
      kraPin: String(formData.get("kra_pin") ?? ""),
    };

    if (idRaw) {
      const id = Number(idRaw);
      updateCustomer(id, input, user.id);
      revalidatePath(`/customers/${id}`);
      revalidatePath("/customers");
      return { ok: "Saved." };
    }

    createCustomer(input, user.id);
    revalidatePath("/customers");
    return { ok: `${input.name.trim()} added.` };
  } catch (err) {
    return { error: message(err) };
  }
}

export async function recordPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();

  try {
    const customerId = Number(formData.get("customer_id"));
    const amountCents = centsFromField(formData.get("amount"), "The amount");
    if (amountCents <= 0) return { error: "Enter the amount received." };

    const method = String(formData.get("method") ?? "cash") as PaymentMethod;
    const code = String(formData.get("mpesa_code") ?? "").trim().toUpperCase();

    const parts = recordPayment({
      customerId,
      amountCents,
      method,
      mpesaCode: method === "mpesa" && code ? code : null,
      userId: user.id,
    });

    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/customers");

    const cleared = parts.filter((p) => p.clearedSale).length;
    return {
      ok:
        parts.length === 1
          ? `Payment recorded. ${cleared ? "That sale is now settled." : "Part-payment applied to the oldest sale."}`
          : `Payment split across ${parts.length} sales, oldest first. ${cleared} settled.`,
    };
  } catch (err) {
    return { error: message(err) };
  }
}

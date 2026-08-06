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
import {
  createCustomer,
  updateCustomer,
  recordPayment,
  balanceOf,
  type CustomerKind,
  type PaymentMethod,
} from "@/lib/credit";
import { toCents, formatKes } from "@/lib/units";

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

    // The one thing the person at the counter needs read back to them is the
    // new balance — not how the money was spread across invoices. Which
    // invoices it cleared is on the statement, for whoever asks later.
    const left = balanceOf(customerId);
    return {
      ok:
        left > 0
          ? `${formatKes(amountCents)} received. Still owing ${formatKes(left)}.`
          : `${formatKes(amountCents)} received. The account is now clear.`,
    };
  } catch (err) {
    return { error: message(err) };
  }
}

/**
 * Add a customer from the counter, mid-sale.
 *
 * The full form lives on the debtors screen and asks for five things. This asks
 * for two, because the moment it is used is the moment somebody is standing
 * there waiting: a name, and the phone number the receipt will be sent to.
 * Everything else — what they buy at, their credit limit, their KRA PIN — is
 * the owner's to set afterwards, and the sale should not wait for it.
 *
 * A new customer therefore starts with no credit limit agreed, which is the
 * safe default and not an oversight: credit to them needs the owner's PIN until
 * he decides otherwise.
 */
export async function quickAddCustomerAction(
  name: string,
  phone: string,
): Promise<{ ok: true; id: number; name: string } | { ok: false; error: string }> {
  const user = await requireUser();

  try {
    const id = createCustomer({ name, phone, kind: "retail", creditLimitCents: 0, kraPin: "" }, user.id);
    revalidatePath("/customers");
    return { ok: true, id, name: name.trim() };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

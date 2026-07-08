"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { parseAmount } from "@/server/money";

export type FormState = { error?: string };

function str(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
}
function parseDate(v: FormDataEntryValue | null): Date {
  const s = String(v ?? "").trim();
  const d = s ? new Date(s) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

export async function saveExpenseAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();
  const id = str(fd, "id");

  const description = str(fd, "description");
  if (!description) return { error: "What was the expense for? A description is required." };

  const amount = parseAmount(fd.get("amount"));
  if (amount <= 0) return { error: "Enter an amount greater than zero." };

  const values = {
    expenseDate: parseDate(fd.get("expenseDate")),
    category: str(fd, "category"),
    payee: str(fd, "payee"),
    description,
    amount,
    taxAmount: parseAmount(fd.get("taxAmount")),
    method: str(fd, "method") ?? "cash",
    reference: str(fd, "reference"),
    notes: str(fd, "notes"),
    updatedAt: new Date(),
  };

  if (id) {
    await db
      .update(schema.expense)
      .set(values)
      .where(and(eq(schema.expense.id, id), eq(schema.expense.organizationId, organizationId)));
  } else {
    await db.insert(schema.expense).values({ organizationId, ...values });
  }

  revalidatePath("/expenses");
  revalidatePath("/reports");
  redirect("/expenses");
}

export async function deleteExpenseAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  if (!id) return;
  await db
    .delete(schema.expense)
    .where(and(eq(schema.expense.id, id), eq(schema.expense.organizationId, organizationId)));
  revalidatePath("/expenses");
  revalidatePath("/reports");
  redirect("/expenses");
}

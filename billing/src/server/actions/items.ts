"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { parseAmount, parseRate } from "@/server/money";

export type FormState = { error?: string };

export async function saveItemAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "").trim() || null;
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Item name is required." };

  const values = {
    name,
    description: String(fd.get("description") ?? "").trim() || null,
    unitPrice: parseAmount(fd.get("unitPrice")),
    unit: String(fd.get("unit") ?? "unit").trim() || "unit",
    taxRateBps: parseRate(fd.get("taxRate")),
    kind: String(fd.get("kind") ?? "service") === "good" ? "good" : "service",
    active: fd.get("active") === "on",
  };

  if (id) {
    await db
      .update(schema.item)
      .set(values)
      .where(and(eq(schema.item.id, id), eq(schema.item.organizationId, organizationId)));
  } else {
    await db.insert(schema.item).values({ organizationId, ...values });
  }

  revalidatePath("/items");
  redirect("/items");
}

export async function deleteItemAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  if (!id) return;
  await db
    .delete(schema.item)
    .where(and(eq(schema.item.id, id), eq(schema.item.organizationId, organizationId)));
  revalidatePath("/items");
  redirect("/items");
}

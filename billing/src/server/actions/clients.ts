"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";

export type FormState = { error?: string };

function str(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
}

export async function saveClientAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (!name) return { error: "Client name is required." };

  const values = {
    name,
    contactPerson: str(fd, "contactPerson"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    kraPin: str(fd, "kraPin")?.toUpperCase() ?? null,
    addressLine1: str(fd, "addressLine1"),
    city: str(fd, "city"),
    country: str(fd, "country") ?? "Kenya",
    currency: str(fd, "currency") ?? "KES",
    notes: str(fd, "notes"),
  };

  if (id) {
    // Update only within this org (tenancy guard)
    await db
      .update(schema.client)
      .set(values)
      .where(and(eq(schema.client.id, id), eq(schema.client.organizationId, organizationId)));
  } else {
    await db.insert(schema.client).values({ organizationId, ...values });
  }

  revalidatePath("/clients");
  redirect("/clients");
}

export async function deleteClientAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  if (!id) return;

  // Guard: don't delete a client that has invoices (would orphan financial records)
  const invoices = await db
    .select({ id: schema.invoice.id })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.clientId, id), eq(schema.invoice.organizationId, organizationId)))
    .limit(1);
  if (invoices.length > 0) {
    redirect(`/clients/${id}?error=has-invoices`);
  }

  await db
    .delete(schema.client)
    .where(and(eq(schema.client.id, id), eq(schema.client.organizationId, organizationId)));
  revalidatePath("/clients");
  redirect("/clients");
}

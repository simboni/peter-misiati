"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, eq, inArray, ne } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { getAuth } from "@/server/auth";
import { schema, type DB } from "@/server/db";

export type FormState = { error?: string };

/**
 * Permanently erase one organization and everything that hangs off it. Deletes
 * in dependency order so it works whether or not D1 enforces foreign keys
 * (see server/actions/reset.ts for the same defensive approach).
 */
async function purgeOrganization(db: DB, organizationId: string): Promise<void> {
  // Child rows first (things that reference an invoice / note / recurring row).
  const invoices = await db
    .select({ id: schema.invoice.id })
    .from(schema.invoice)
    .where(eq(schema.invoice.organizationId, organizationId));
  const invoiceIds = invoices.map((r) => r.id);
  if (invoiceIds.length > 0) {
    await db.delete(schema.invoiceLine).where(inArray(schema.invoiceLine.invoiceId, invoiceIds));
  }

  const creditNotes = await db
    .select({ id: schema.creditNote.id })
    .from(schema.creditNote)
    .where(eq(schema.creditNote.organizationId, organizationId));
  const creditNoteIds = creditNotes.map((r) => r.id);
  if (creditNoteIds.length > 0) {
    await db.delete(schema.creditNoteLine).where(inArray(schema.creditNoteLine.creditNoteId, creditNoteIds));
  }

  const deliveryNotes = await db
    .select({ id: schema.deliveryNote.id })
    .from(schema.deliveryNote)
    .where(eq(schema.deliveryNote.organizationId, organizationId));
  const deliveryNoteIds = deliveryNotes.map((r) => r.id);
  if (deliveryNoteIds.length > 0) {
    await db.delete(schema.deliveryNoteLine).where(inArray(schema.deliveryNoteLine.deliveryNoteId, deliveryNoteIds));
  }

  const recurring = await db
    .select({ id: schema.recurringInvoice.id })
    .from(schema.recurringInvoice)
    .where(eq(schema.recurringInvoice.organizationId, organizationId));
  const recurringIds = recurring.map((r) => r.id);
  if (recurringIds.length > 0) {
    await db
      .delete(schema.recurringInvoiceLine)
      .where(inArray(schema.recurringInvoiceLine.recurringInvoiceId, recurringIds));
  }

  // Org-scoped rows.
  await db.delete(schema.paymentIntent).where(eq(schema.paymentIntent.organizationId, organizationId));
  await db.delete(schema.payment).where(eq(schema.payment.organizationId, organizationId));
  await db.delete(schema.creditNote).where(eq(schema.creditNote.organizationId, organizationId));
  await db.delete(schema.deliveryNote).where(eq(schema.deliveryNote.organizationId, organizationId));
  await db.delete(schema.recurringInvoice).where(eq(schema.recurringInvoice.organizationId, organizationId));
  await db.delete(schema.invoice).where(eq(schema.invoice.organizationId, organizationId));
  await db.delete(schema.expense).where(eq(schema.expense.organizationId, organizationId));
  await db.delete(schema.client).where(eq(schema.client.organizationId, organizationId));
  await db.delete(schema.item).where(eq(schema.item.organizationId, organizationId));
  await db.delete(schema.numberSequence).where(eq(schema.numberSequence.organizationId, organizationId));
  await db.delete(schema.orgProfile).where(eq(schema.orgProfile.organizationId, organizationId));
  await db.delete(schema.pushToken).where(eq(schema.pushToken.organizationId, organizationId));
  await db.delete(schema.invitation).where(eq(schema.invitation.organizationId, organizationId));
  await db.delete(schema.member).where(eq(schema.member.organizationId, organizationId));

  // The organization itself.
  await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
}

/**
 * Delete the signed-in user's account and all of their data — the in-app path
 * Google Play requires. Any workspace the user OWNS is erased in full (its
 * invoices, receipts, clients, everything); workspaces where they are only a
 * member simply lose their membership. Then the user record itself — sessions,
 * logins, push tokens, invitations — is removed and they are signed out.
 *
 * Guarded by typing the exact confirmation phrase. Irreversible.
 */
export async function deleteAccountAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await requireOrg();

  if (String(fd.get("confirm") ?? "").trim() !== "DELETE MY ACCOUNT") {
    return { error: "Type DELETE MY ACCOUNT exactly to confirm." };
  }

  // Every org this user belongs to, with their role in each.
  const memberships = await db
    .select({ organizationId: schema.member.organizationId, role: schema.member.role })
    .from(schema.member)
    .where(eq(schema.member.userId, userId));

  // Guard the blast radius: deleting your account purges any workspace you OWN,
  // which would also wipe every co-owner's and member's data. Refuse if an
  // owned workspace still has other members — the user must remove/transfer
  // them first, so "delete my account" can never silently destroy other people.
  for (const m of memberships) {
    if (m.role !== "owner") continue;
    const others = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, m.organizationId), ne(schema.member.userId, userId)))
      .limit(1);
    if (others[0]) {
      return {
        error:
          "You own a workspace that still has other members. Remove them (or transfer ownership) before deleting your account, so their data isn't deleted.",
      };
    }
  }

  for (const m of memberships) {
    // Owner leaving a workspace where they are now the only member = dissolve it.
    if (m.role === "owner") await purgeOrganization(db, m.organizationId);
  }

  // Anything still tied to the user directly (drops any remaining member seats
  // in workspaces this user did not own; most other rows cascaded above).
  await db.delete(schema.pushToken).where(eq(schema.pushToken.userId, userId));
  await db.delete(schema.member).where(eq(schema.member.userId, userId));
  await db.delete(schema.invitation).where(eq(schema.invitation.inviterId, userId));
  await db.delete(schema.session).where(eq(schema.session.userId, userId));
  await db.delete(schema.account).where(eq(schema.account.userId, userId));
  await db.delete(schema.user).where(eq(schema.user.id, userId));

  // Best-effort sign-out to clear the session cookie; the row is already gone.
  try {
    const auth = await getAuth();
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // ignore — the session row no longer exists
  }

  redirect("/login");
}

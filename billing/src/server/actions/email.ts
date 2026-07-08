"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { appBaseUrl } from "@/server/config";
import { sendEmail, documentEmailHtml } from "@/server/resend";
import { formatMoney } from "@/server/money";

/** Email the shared invoice/quotation link to the client (address from their record). */
export async function emailInvoiceAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  const base = `/invoices/${id}`;
  if (!id) redirect("/invoices");

  const rows = await db
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.organizationId, organizationId)))
    .limit(1);
  const inv = rows[0];
  if (!inv) redirect("/invoices");
  const path = `/${inv.type === "quotation" ? "quotations" : "invoices"}/${id}`;

  const clientRows = await db.select().from(schema.client).where(eq(schema.client.id, inv.clientId)).limit(1);
  const client = clientRows[0];
  if (!client?.email) redirect(`${path}?error=no-email`);

  const [org, profile] = await Promise.all([
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
  ]);
  const businessName = org?.name ?? "Your business";
  const label = `${inv.type === "quotation" ? "Quotation" : "Invoice"} ${inv.number}`;
  const amountLine =
    inv.type === "quotation"
      ? `Total: ${formatMoney(inv.total, inv.currency)}`
      : `Balance due: ${formatMoney(inv.balanceDue, inv.currency)}`;
  const url = `${await appBaseUrl()}/d/${inv.shareToken}`;

  const result = await sendEmail({
    to: client.email,
    replyTo: profile?.email ?? null,
    subject: `${label} from ${businessName}`,
    html: documentEmailHtml({
      businessName,
      docLabel: label,
      clientName: client.name,
      amountLine,
      url,
      canPay: inv.type === "invoice" && inv.balanceDue > 0,
      footer: profile?.invoiceFooter ?? null,
    }),
  });

  if (!result.ok) {
    redirect(`${path}?error=${encodeURIComponent(result.error ?? "email-failed")}`);
  }

  // Mark as sent (keeps a paid/partial status intact; only promotes draft→sent).
  if (inv.status === "draft") {
    await db
      .update(schema.invoice)
      .set({ status: inv.type === "quotation" ? "sent" : "sent", sentAt: new Date() })
      .where(eq(schema.invoice.id, id));
  } else {
    await db.update(schema.invoice).set({ sentAt: new Date() }).where(eq(schema.invoice.id, id));
  }
  revalidatePath(path);
  redirect(`${path}?sent=1`);
}

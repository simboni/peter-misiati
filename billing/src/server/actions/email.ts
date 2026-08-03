"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { sendEmail, pdfEmailHtml } from "@/server/resend";
import { formatMoney } from "@/server/money";

/**
 * Email the invoice/quotation to the client as a PDF attachment (no link).
 * The PDF is built in the vendor's browser (keeps the heavy PDF library out of
 * the Worker) and posted here as base64; we attach it and send via Resend.
 */
export async function emailInvoiceAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const id = String(fd.get("id") ?? "");
  const pdfBase64 = String(fd.get("pdf") ?? "");
  if (!id) redirect("/invoices");

  const rows = await db
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.organizationId, organizationId)))
    .limit(1);
  const inv = rows[0];
  if (!inv) redirect("/invoices");
  const path = `/${inv.type === "quotation" ? "quotations" : "invoices"}/${id}`;
  if (!pdfBase64) redirect(`${path}?error=${encodeURIComponent("Could not prepare the PDF. Please try again.")}`);

  const [clientRows, org, profile] = await Promise.all([
    db.select().from(schema.client).where(eq(schema.client.id, inv.clientId)).limit(1),
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
  ]);
  const client = clientRows[0];
  if (!client?.email) redirect(`${path}?error=no-email`);

  const businessName = org?.name ?? "Your business";
  const label = `${inv.type === "quotation" ? "Quotation" : "Invoice"} ${inv.number}`;
  const amountLine =
    inv.type === "quotation"
      ? `Total: ${formatMoney(inv.total, inv.currency)}`
      : `Balance due: ${formatMoney(inv.balanceDue, inv.currency)}`;
  const fileName = `${label.replace(/\s+/g, "-")}.pdf`;

  const result = await sendEmail({
    to: client.email,
    replyTo: profile?.email ?? null,
    subject: `${label} from ${businessName}`,
    html: pdfEmailHtml({
      businessName,
      docLabel: label,
      clientName: client.name,
      amountLine,
      fileName,
      footer: profile?.invoiceFooter ?? null,
    }),
    attachments: [{ filename: fileName, content: pdfBase64 }],
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

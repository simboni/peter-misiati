import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { browserEnabled } from "@/server/config";
import { SERVER_PDF_ENABLED } from "@/lib/flags";
import { isPro } from "@/lib/plan";
import { pdfIssuer } from "@/server/pdf-issuer";
import { loadInvoice } from "@/server/queries";
import { InvoiceDetail } from "@/components/invoice-detail";

// Name the browser tab after the document itself so "Save as PDF" produces
// "Invoice INV-0041.pdf" — `absolute` drops the "· TallyPay" title suffix.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { db, organizationId } = await requireOrg();
  const rows = await db
    .select({ number: schema.invoice.number, type: schema.invoice.type })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.organizationId, organizationId)))
    .limit(1);
  const r = rows[0];
  const label = r ? `${r.type === "quotation" ? "Quotation" : "Invoice"} ${r.number}` : "Invoice";
  return { title: { absolute: label } };
}

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { id } = await params;
  const { error, sent } = await searchParams;
  const { db, organizationId } = await requireOrg();
  const [doc, org, profile] = await Promise.all([
    loadInvoice(db, organizationId, id),
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
  ]);
  if (!doc || doc.invoice.type !== "invoice") notFound();

  return (
    <InvoiceDetail
      invoice={doc.invoice}
      lines={doc.lines}
      client={doc.client}
      payments={doc.payments}
      error={error}
      sent={sent === "1"}
      pdfEnabled={SERVER_PDF_ENABLED && (await browserEnabled())}
      pro={isPro(profile?.plan)}
      issuer={pdfIssuer(org?.name ?? "Business", profile)}
    />
  );
}

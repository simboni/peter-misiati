import { notFound } from "next/navigation";
import { requireOrg } from "@/server/org";
import { browserEnabled } from "@/server/config";
import { loadInvoice } from "@/server/queries";
import { InvoiceDetail } from "@/components/invoice-detail";

export const metadata = { title: "Quotation" };

export default async function QuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { id } = await params;
  const { error, sent } = await searchParams;
  const { db, organizationId } = await requireOrg();
  const doc = await loadInvoice(db, organizationId, id);
  if (!doc || doc.invoice.type !== "quotation") notFound();

  return (
    <InvoiceDetail
      invoice={doc.invoice}
      lines={doc.lines}
      client={doc.client}
      payments={doc.payments}
      error={error}
      sent={sent === "1"}
      pdfEnabled={await browserEnabled()}
    />
  );
}

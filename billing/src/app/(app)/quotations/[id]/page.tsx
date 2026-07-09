import { notFound } from "next/navigation";
import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { browserEnabled } from "@/server/config";
import { SERVER_PDF_ENABLED } from "@/lib/flags";
import { isPro } from "@/lib/plan";
import { pdfIssuer } from "@/server/pdf-issuer";
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
  const [doc, org, profile] = await Promise.all([
    loadInvoice(db, organizationId, id),
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
  ]);
  if (!doc || doc.invoice.type !== "quotation") notFound();

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

export const dynamic = "force-dynamic";
import { notFound } from "next/navigation";
import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getOrg, getOrgProfile } from "@/server/org";
import { browserEnabled, appBaseUrl } from "@/server/config";
import { kopokopoConfigForOrg } from "@/server/payments-config";
import { MPESA_PAYMENTS_ENABLED, SERVER_PDF_ENABLED } from "@/lib/flags";
import { PrintBar } from "@/components/documents/print-bar";
import { PayPanel } from "@/components/pay-panel";
import { formatMoney } from "@/server/money";
import { fmtDate } from "@/server/queries";
import {
  InvoiceDocument,
  ReceiptDocument,
  DeliveryNoteDocument,
  CreditNoteDocument,
} from "@/components/documents/templates";

import type { Metadata } from "next";

// Public share links always use the TallyPay app domain. (The client-facing
// link PREVIEW is still fully vendor-branded via the Open Graph metadata below
// — business name, address, logo and amount — so clients see the vendor, not
// TallyPay, even though the URL is tallypay.co.ke.)
async function shareBaseFor(_profile?: unknown): Promise<string> {
  return await appBaseUrl();
}

// Vendor-branded link-preview (Open Graph) data: the sharing card shows the
// issuing business's name, address, logo and the document amount — so the
// client feels they're dealing with the vendor, not TallyPay. Falls back to a
// plain title if the token doesn't resolve.
type ShareMeta = { title: string; description: string; siteName: string; base: string; hasLogo: boolean };
async function metaForToken(db: Awaited<ReturnType<typeof getDb>>, token: string): Promise<ShareMeta | null> {
  const brand = async (organizationId: string, currencyFallback = "KES") => {
    const [org, profile] = await Promise.all([getOrg(db, organizationId), getOrgProfile(db, organizationId)]);
    const vendorName = profile?.legalName || org?.name || "Business";
    const addr = [profile?.addressLine1, profile?.city].filter(Boolean).join(", ");
    return { vendorName, addr, base: await shareBaseFor(profile), hasLogo: Boolean(profile?.logoUrl), currency: profile?.currency ?? currencyFallback };
  };

  const inv = await db.select({ number: schema.invoice.number, type: schema.invoice.type, total: schema.invoice.total, currency: schema.invoice.currency, dueDate: schema.invoice.dueDate, organizationId: schema.invoice.organizationId }).from(schema.invoice).where(eq(schema.invoice.shareToken, token)).limit(1);
  if (inv[0]) {
    const b = await brand(inv[0].organizationId, inv[0].currency);
    const kind = inv[0].type === "quotation" ? "Quotation" : "Invoice";
    const due = inv[0].type !== "quotation" && inv[0].dueDate ? `, due ${fmtDate(inv[0].dueDate)}` : "";
    return { title: `${kind} ${inv[0].number} — ${b.vendorName}`, description: `${b.vendorName}${b.addr ? ` · ${b.addr}` : ""} — ${formatMoney(inv[0].total, inv[0].currency)}${due}`, siteName: b.vendorName, base: b.base, hasLogo: b.hasLogo };
  }
  const pay = await db.select({ number: schema.payment.number, amount: schema.payment.amount, organizationId: schema.payment.organizationId }).from(schema.payment).where(eq(schema.payment.shareToken, token)).limit(1);
  if (pay[0]) {
    const b = await brand(pay[0].organizationId);
    return { title: `Receipt ${pay[0].number} — ${b.vendorName}`, description: `${b.vendorName}${b.addr ? ` · ${b.addr}` : ""} — Payment received: ${formatMoney(pay[0].amount, b.currency)}`, siteName: b.vendorName, base: b.base, hasLogo: b.hasLogo };
  }
  const dn = await db.select({ number: schema.deliveryNote.number, organizationId: schema.deliveryNote.organizationId }).from(schema.deliveryNote).where(eq(schema.deliveryNote.shareToken, token)).limit(1);
  if (dn[0]) {
    const b = await brand(dn[0].organizationId);
    return { title: `Delivery Note ${dn[0].number} — ${b.vendorName}`, description: `${b.vendorName}${b.addr ? ` · ${b.addr}` : ""} — Delivery note`, siteName: b.vendorName, base: b.base, hasLogo: b.hasLogo };
  }
  const cn = await db.select({ number: schema.creditNote.number, total: schema.creditNote.total, currency: schema.creditNote.currency, organizationId: schema.creditNote.organizationId }).from(schema.creditNote).where(eq(schema.creditNote.shareToken, token)).limit(1);
  if (cn[0]) {
    const b = await brand(cn[0].organizationId, cn[0].currency);
    return { title: `Credit Note ${cn[0].number} — ${b.vendorName}`, description: `${b.vendorName} — Credit note ${formatMoney(cn[0].total, cn[0].currency)}`, siteName: b.vendorName, base: b.base, hasLogo: b.hasLogo };
  }
  return null;
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const m = await metaForToken(await getDb(), token);
  if (!m) return { title: "Document" };
  const images = m.hasLogo ? [{ url: `${m.base}/d/${token}/logo` }] : undefined;
  return {
    title: { absolute: m.title },
    description: m.description,
    openGraph: { title: m.title, description: m.description, siteName: m.siteName, type: "website", url: `${m.base}/d/${token}`, images },
    twitter: { card: images ? "summary_large_image" : "summary", title: m.title, description: m.description, images: images?.map((i) => i.url) },
    // Private shared documents shouldn't be search-indexed.
    robots: { index: false, follow: false },
  };
}

async function issuerFor(db: Awaited<ReturnType<typeof getDb>>, organizationId: string) {
  const [org, profile] = await Promise.all([
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
  ]);
  return { name: org?.name ?? "Business", profile };
}

export default async function PublicDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = await getDb();
  const pdfHref = SERVER_PDF_ENABLED && (await browserEnabled()) ? `/d/${token}/pdf` : null;

  // 1) Invoice or quotation
  const invRows = await db
    .select()
    .from(schema.invoice)
    .where(eq(schema.invoice.shareToken, token))
    .limit(1);
  if (invRows.length > 0) {
    const invoice = invRows[0];
    const [lines, clientRows, issuer] = await Promise.all([
      db
        .select()
        .from(schema.invoiceLine)
        .where(eq(schema.invoiceLine.invoiceId, invoice.id))
        .orderBy(schema.invoiceLine.sortOrder),
      db.select().from(schema.client).where(eq(schema.client.id, invoice.clientId)).limit(1),
      issuerFor(db, invoice.organizationId),
    ]);
    const client = clientRows[0] ?? null;
    const canPay =
      MPESA_PAYMENTS_ENABLED &&
      invoice.type === "invoice" &&
      invoice.status !== "void" &&
      invoice.balanceDue > 0 &&
      (await kopokopoConfigForOrg(db, invoice.organizationId)) !== null;
    const base = await shareBaseFor(issuer.profile);
    const payUrl = canPay ? `${base}/d/${invoice.shareToken}` : null;
    return (
      <>
        <PrintBar
          docLabel={`${invoice.type === "quotation" ? "Quotation" : "Invoice"} ${invoice.number}`}
          clientEmail={client?.email}
          clientPhone={client?.phone}
          pdfHref={pdfHref}
        />
        {canPay && (
          <div className="no-print mx-auto mt-4 max-w-[820px] px-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
              <div>
                <p className="text-sm font-semibold text-ink">
                  Balance due: {formatMoney(invoice.balanceDue, invoice.currency)}
                </p>
                <p className="text-xs text-muted">Pay securely by M-Pesa — in full or part.</p>
              </div>
              <div className="w-full sm:w-64">
                <PayPanel
                  token={invoice.shareToken}
                  balanceDue={invoice.balanceDue}
                  currency={invoice.currency}
                  clientPhone={client?.phone}
                />
              </div>
            </div>
          </div>
        )}
        <div id="tp-doc" className="p-4 print:p-0">
          <InvoiceDocument issuer={issuer} invoice={invoice} lines={lines} client={client} payUrl={payUrl} />
        </div>
      </>
    );
  }

  // 2) Receipt (payment)
  const payRows = await db
    .select()
    .from(schema.payment)
    .where(eq(schema.payment.shareToken, token))
    .limit(1);
  if (payRows.length > 0) {
    const payment = payRows[0];
    const [invRows2, clientRows, priors, issuer] = await Promise.all([
      db.select().from(schema.invoice).where(eq(schema.invoice.id, payment.invoiceId)).limit(1),
      db.select().from(schema.client).where(eq(schema.client.id, payment.clientId)).limit(1),
      db
        .select({ amount: schema.payment.amount })
        .from(schema.payment)
        .where(and(eq(schema.payment.invoiceId, payment.invoiceId), lt(schema.payment.createdAt, payment.createdAt))),
      issuerFor(db, payment.organizationId),
    ]);
    if (invRows2.length === 0) notFound();
    const priorPaid = priors.reduce((a, p) => a + p.amount, 0);
    const client = clientRows[0] ?? null;
    return (
      <>
        <PrintBar
          docLabel={`Receipt ${payment.number}`}
          clientEmail={client?.email}
          clientPhone={client?.phone}
          pdfHref={pdfHref}
        />
        <div id="tp-doc" className="p-4 print:p-0">
          <ReceiptDocument
            issuer={issuer}
            payment={payment}
            invoice={invRows2[0]}
            client={client}
            priorPaid={priorPaid}
          />
        </div>
      </>
    );
  }

  // 3) Delivery note
  const dnRows = await db
    .select()
    .from(schema.deliveryNote)
    .where(eq(schema.deliveryNote.shareToken, token))
    .limit(1);
  if (dnRows.length > 0) {
    const note = dnRows[0];
    const [lines, clientRows, issuer, invRows3] = await Promise.all([
      db
        .select()
        .from(schema.deliveryNoteLine)
        .where(eq(schema.deliveryNoteLine.deliveryNoteId, note.id))
        .orderBy(schema.deliveryNoteLine.sortOrder),
      db.select().from(schema.client).where(eq(schema.client.id, note.clientId)).limit(1),
      issuerFor(db, note.organizationId),
      note.invoiceId
        ? db
            .select({ number: schema.invoice.number })
            .from(schema.invoice)
            .where(eq(schema.invoice.id, note.invoiceId))
            .limit(1)
        : Promise.resolve([]),
    ]);
    const client = clientRows[0] ?? null;
    return (
      <>
        <PrintBar
          docLabel={`Delivery Note ${note.number}`}
          clientEmail={client?.email}
          clientPhone={client?.phone}
          pdfHref={pdfHref}
        />
        <div id="tp-doc" className="p-4 print:p-0">
          <DeliveryNoteDocument
            issuer={issuer}
            note={note}
            lines={lines}
            client={client}
            invoiceNumber={invRows3[0]?.number ?? null}
          />
        </div>
      </>
    );
  }

  // 4) Credit note
  const cnRows = await db
    .select()
    .from(schema.creditNote)
    .where(eq(schema.creditNote.shareToken, token))
    .limit(1);
  if (cnRows.length > 0) {
    const cn = cnRows[0];
    const [lines, clientRows, issuer, invRows4] = await Promise.all([
      db
        .select()
        .from(schema.creditNoteLine)
        .where(eq(schema.creditNoteLine.creditNoteId, cn.id))
        .orderBy(schema.creditNoteLine.sortOrder),
      db.select().from(schema.client).where(eq(schema.client.id, cn.clientId)).limit(1),
      issuerFor(db, cn.organizationId),
      cn.invoiceId
        ? db.select({ number: schema.invoice.number }).from(schema.invoice).where(eq(schema.invoice.id, cn.invoiceId)).limit(1)
        : Promise.resolve([]),
    ]);
    const client = clientRows[0] ?? null;
    return (
      <>
        <PrintBar
          docLabel={`Credit Note ${cn.number}`}
          clientEmail={client?.email}
          clientPhone={client?.phone}
          pdfHref={pdfHref}
        />
        <div id="tp-doc" className="p-4 print:p-0">
          <CreditNoteDocument issuer={issuer} creditNote={cn} lines={lines} client={client} invoiceNumber={invRows4[0]?.number ?? null} />
        </div>
      </>
    );
  }

  notFound();
}

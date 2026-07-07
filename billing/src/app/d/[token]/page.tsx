export const dynamic = "force-dynamic";
import { notFound } from "next/navigation";
import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getOrg, getOrgProfile } from "@/server/org";
import { PrintBar } from "@/components/documents/print-bar";
import {
  InvoiceDocument,
  ReceiptDocument,
  DeliveryNoteDocument,
} from "@/components/documents/templates";

export const metadata = { title: "Document" };

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
    return (
      <>
        <PrintBar
          docLabel={`${invoice.type === "quotation" ? "quotation" : "invoice"} ${invoice.number}`}
          clientEmail={client?.email}
          clientPhone={client?.phone}
        />
        <div className="p-4 print:p-0">
          <InvoiceDocument issuer={issuer} invoice={invoice} lines={lines} client={client} />
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
        <PrintBar docLabel={`receipt ${payment.number}`} clientEmail={client?.email} clientPhone={client?.phone} />
        <div className="p-4 print:p-0">
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
        <PrintBar docLabel={`delivery note ${note.number}`} clientEmail={client?.email} clientPhone={client?.phone} />
        <div className="p-4 print:p-0">
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

  notFound();
}

import { and, eq, desc } from "drizzle-orm";
import { schema, type DB } from "./db";

/** Load a single invoice/quotation with its lines + client, scoped to the org. */
export async function loadInvoice(db: DB, organizationId: string, id: string) {
  const rows = await db
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.organizationId, organizationId)))
    .limit(1);
  const invoice = rows[0];
  if (!invoice) return null;

  const [lines, clientRows, payments] = await Promise.all([
    db
      .select()
      .from(schema.invoiceLine)
      .where(eq(schema.invoiceLine.invoiceId, id))
      .orderBy(schema.invoiceLine.sortOrder),
    db.select().from(schema.client).where(eq(schema.client.id, invoice.clientId)).limit(1),
    db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.invoiceId, id))
      .orderBy(desc(schema.payment.paidAt)),
  ]);

  return { invoice, lines, client: clientRows[0] ?? null, payments };
}

/** Formatted date helper (server + client safe). */
export function fmtDate(d?: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

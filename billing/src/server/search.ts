/**
 * Global search — one query box over invoices, clients and items.
 *
 * Kept deliberately small: a handful of indexed LIKE scans with tight limits,
 * not a search engine. These tables are per-tenant and a busy vendor has
 * hundreds of rows, not millions, so the cost of LIKE '%term%' is a rounding
 * error next to the round-trip. If that stops being true the escape hatch is
 * SQLite FTS5 on a shadow table, not a bigger WHERE clause.
 */

import { and, eq, or, desc, sql, type AnyColumn } from "drizzle-orm";
import { schema, type DB } from "./db";
import type { Hit } from "@/lib/search";

export type { Hit };

/** SQLite LIKE is case-insensitive for ASCII, which is what we need here. */
function term(q: string): string {
  // Escape the LIKE wildcards so a user typing "50%" searches for a literal
  // "50%". Backslash first, or we would escape our own escapes.
  const cleaned = q.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${cleaned}%`;
}

/**
 * LIKE with an explicit ESCAPE clause.
 *
 * Drizzle's like() emits a bare LIKE, and SQLite then treats a backslash as an
 * ordinary character — so escaping the pattern without this would search for a
 * literal "\%" and silently find nothing. Values are still bound parameters;
 * this is about correctness for names like "50% off", not injection.
 */
function likeEsc(col: AnyColumn, pattern: string) {
  return sql`${col} LIKE ${pattern} ESCAPE '\\'`;
}

/**
 * Does this look like someone typing an amount? "20000", "20,000", "20000.50".
 * Used to decide whether to also match on invoice totals.
 */
function asAmountMinor(q: string): number | null {
  const t = q.trim().replace(/[, ]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

const PER_GROUP = 6;

export async function globalSearch(db: DB, organizationId: string, q: string): Promise<Hit[]> {
  const query = q.trim();
  if (query.length < 2) return [];

  const t = term(query);
  const amount = asAmountMinor(query);

  // Invoices and quotations: by number, by client name, and by exact total when
  // the query parses as money — "20000" should find the 20,000 invoice.
  const docsP = db
    .select({
      id: schema.invoice.id,
      number: schema.invoice.number,
      type: schema.invoice.type,
      status: schema.invoice.status,
      total: schema.invoice.total,
      balanceDue: schema.invoice.balanceDue,
      currency: schema.invoice.currency,
      clientName: schema.client.name,
    })
    .from(schema.invoice)
    .innerJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
    .where(
      and(
        eq(schema.invoice.organizationId, organizationId),
        or(
          likeEsc(schema.invoice.number, t),
          likeEsc(schema.client.name, t),
          ...(amount !== null ? [eq(schema.invoice.total, amount)] : []),
        ),
      ),
    )
    .orderBy(desc(schema.invoice.createdAt))
    .limit(PER_GROUP * 2);

  const clientsP = db
    .select({
      id: schema.client.id,
      name: schema.client.name,
      email: schema.client.email,
      phone: schema.client.phone,
    })
    .from(schema.client)
    .where(
      and(
        eq(schema.client.organizationId, organizationId),
        or(
          likeEsc(schema.client.name, t),
          likeEsc(schema.client.email, t),
          likeEsc(schema.client.phone, t),
          likeEsc(schema.client.contactPerson, t),
        ),
      ),
    )
    .orderBy(schema.client.name)
    .limit(PER_GROUP);

  const itemsP = db
    .select({
      id: schema.item.id,
      name: schema.item.name,
      description: schema.item.description,
      unitPrice: schema.item.unitPrice,
      unit: schema.item.unit,
    })
    .from(schema.item)
    .where(
      and(
        eq(schema.item.organizationId, organizationId),
        eq(schema.item.active, true),
        or(likeEsc(schema.item.name, t), likeEsc(schema.item.description, t)),
      ),
    )
    .orderBy(schema.item.name)
    .limit(PER_GROUP);

  const [docs, clients, items] = await Promise.all([docsP, clientsP, itemsP]);

  const hits: Hit[] = [];

  for (const d of docs.slice(0, PER_GROUP * 2)) {
    const isQuote = d.type === "quotation";
    hits.push({
      kind: isQuote ? "quotation" : "invoice",
      id: d.id,
      title: d.number,
      subtitle: d.clientName,
      href: `/${isQuote ? "quotations" : "invoices"}/${d.id}`,
      amount: isQuote ? d.total : d.balanceDue > 0 ? d.balanceDue : d.total,
      currency: d.currency,
      status: d.status,
    });
  }

  for (const c of clients) {
    hits.push({
      kind: "client",
      id: c.id,
      title: c.name,
      subtitle: c.email || c.phone || "No contact details",
      href: `/clients/${c.id}`,
    });
  }

  for (const i of items) {
    hits.push({
      kind: "item",
      id: i.id,
      title: i.name,
      subtitle: i.description || `per ${i.unit}`,
      href: `/items/${i.id}`,
      amount: i.unitPrice,
    });
  }

  return hits;
}

export { SMART_QUERIES } from "@/lib/search";

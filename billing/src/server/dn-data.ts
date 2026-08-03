import { and, eq, desc } from "drizzle-orm";
import { schema, type DB } from "@/server/db";

/** Clients, items and recent invoices for the delivery-note editor. */
export async function loadDnEditorData(db: DB, organizationId: string) {
  const [clients, items, invoices] = await Promise.all([
    db
      .select({ id: schema.client.id, name: schema.client.name })
      .from(schema.client)
      .where(eq(schema.client.organizationId, organizationId))
      .orderBy(schema.client.name),
    db
      .select({ id: schema.item.id, name: schema.item.name, unit: schema.item.unit })
      .from(schema.item)
      .where(and(eq(schema.item.organizationId, organizationId), eq(schema.item.active, true)))
      .orderBy(schema.item.name),
    db
      .select({ id: schema.invoice.id, number: schema.invoice.number })
      .from(schema.invoice)
      .where(and(eq(schema.invoice.organizationId, organizationId), eq(schema.invoice.type, "invoice")))
      .orderBy(desc(schema.invoice.createdAt))
      .limit(50),
  ]);
  return { clients, items, invoices };
}

import { and, eq, desc } from "drizzle-orm";
import { getOrgProfile, type OrgContext } from "@/server/org";
import { schema } from "@/server/db";

/** Load the clients, items and defaults an invoice/quotation editor needs. */
export async function loadEditorData({ db, organizationId }: OrgContext) {
  const [clients, items, profile] = await Promise.all([
    db
      .select({ id: schema.client.id, name: schema.client.name, currency: schema.client.currency })
      .from(schema.client)
      .where(eq(schema.client.organizationId, organizationId))
      .orderBy(schema.client.name),
    db
      .select({
        id: schema.item.id,
        name: schema.item.name,
        description: schema.item.description,
        unitPrice: schema.item.unitPrice,
        taxRateBps: schema.item.taxRateBps,
        unit: schema.item.unit,
      })
      .from(schema.item)
      .where(and(eq(schema.item.organizationId, organizationId), eq(schema.item.active, true)))
      .orderBy(schema.item.name),
    getOrgProfile(db, organizationId),
  ]);

  const defaultVatRateBps = profile?.vatRegistered ? profile.defaultVatRateBps : 0;
  return {
    clients,
    items,
    defaultCurrency: profile?.currency ?? "KES",
    defaultVatRateBps,
    defaultTerms: profile?.invoiceFooter ?? "",
  };
}

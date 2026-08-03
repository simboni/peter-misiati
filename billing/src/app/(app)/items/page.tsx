import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { requireOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/page-header";
import { formatMoney, formatRate } from "@/server/money";

export const metadata = { title: "Items & Services" };

export default async function ItemsPage() {
  const { db, organizationId } = await requireOrg();
  const [items, profile] = await Promise.all([
    db
      .select()
      .from(schema.item)
      .where(eq(schema.item.organizationId, organizationId))
      .orderBy(desc(schema.item.createdAt)),
    getOrgProfile(db, organizationId),
  ]);
  const cur = profile?.currency ?? "KES";

  return (
    <div>
      <PageHeader
        title="Items & Services"
        subtitle="Reusable products and services with prices and VAT rates."
        action={{ href: "/items/new", label: "Add item" }}
      />

      {items.length === 0 ? (
        <EmptyState
          title="No items yet"
          body="Add the products or services you bill for so you can add them to invoices in one click."
          action={{ href: "/items/new", label: "Add item" }}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Name</th>
                <th className="th">Type</th>
                <th className="th text-right">Unit price</th>
                <th className="th text-right">VAT</th>
                <th className="th"></th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((it) => (
                <tr key={it.id} className="hover:bg-canvas">
                  <td className="td font-medium">
                    <Link href={`/items/${it.id}`} className="hover:text-brand-700">
                      {it.name}
                    </Link>
                    {!it.active && (
                      <span className="badge ml-2 bg-slate-100 text-slate-500">inactive</span>
                    )}
                  </td>
                  <td className="td capitalize text-muted">{it.kind}</td>
                  <td className="td text-right">{formatMoney(it.unitPrice, cur)}</td>
                  <td className="td text-right text-muted">{formatRate(it.taxRateBps)}%</td>
                  <td className="td text-muted">per {it.unit}</td>
                  <td className="td text-right">
                    <Link href={`/items/${it.id}`} className="btn-ghost btn-sm">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

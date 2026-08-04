import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { currentUser, requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import {
  authoriseOwnerPin,
  cartTotal,
  creditStatus,
  recordSale,
  topSellerItemIds,
  SaleError,
} from "@/lib/sales";
import { formatKes } from "@/lib/units";
import SellClient, { type SalePayload, type SellCustomer, type SellItem, type SellState } from "./sell-client";

// Stock and prices change with every sale; never serve a cached counter.
export const dynamic = "force-dynamic";

/**
 * Record a sale.
 *
 * The counter sends prices, not the server's own list prices, because haggling
 * is normal here. Everything is re-validated: `recordSale` refuses a price
 * below the item's floor unless an owner PIN came with it, and refuses tenders
 * that overshoot the bill.
 */
async function sellAction(_prev: SellState, payload: SalePayload): Promise<SellState> {
  "use server";

  const user = await requireUser();

  try {
    // A below-floor price is only allowed with an owner standing at the counter.
    let floorOverrideBy: number | null = null;
    if (payload.ownerPin) {
      floorOverrideBy = authoriseOwnerPin(payload.ownerPin);
      if (!floorOverrideBy) {
        return { status: "pin", message: "That is not an owner's PIN. Ask the owner to approve this price." };
      }
    }

    // Warn before the debt is taken on, not after. The owner decides who gets
    // stretched, so this is a warning the staff can override, not a block.
    const customerId = payload.customerId ?? null;
    if (customerId && !payload.acknowledgeCredit) {
      const totalCents = cartTotal(
        payload.lines.map((l) => ({ unitPriceCents: l.unitPriceCents, units: l.units })),
      );
      const paidCents = payload.tenders
        .filter((t) => t.method !== "credit")
        .reduce((s, t) => s + t.amountCents, 0);
      const creditCents = totalCents - paidCents;

      if (creditCents > 0) {
        const status = creditStatus(customerId, creditCents);
        if (status?.exceeds) {
          return {
            status: "credit",
            message:
              `${status.name} owes ${formatKes(status.outstandingCents)} and their limit is ` +
              `${formatKes(status.limitCents)}. This sale takes them to ${formatKes(status.afterCents)}.`,
          };
        }
      }
    }

    const result = recordSale({
      clientUuid: payload.clientUuid,
      userId: user.id,
      tier: payload.tier,
      lines: payload.lines,
      tenders: payload.tenders,
      customerId,
      floorOverrideBy,
    });

    // Pull fresh stock counts and top sellers back into the grid.
    refresh();

    return {
      status: "done",
      saleId: result.saleId,
      totalCents: result.totalCents,
      paidCents: result.paidCents,
      outstandingCents: result.outstandingCents,
    };
  } catch (err) {
    if (err instanceof SaleError) {
      if (err.code === "below_floor") return { status: "pin", message: err.message };
      return { status: "error", message: err.message };
    }
    throw err;
  }
}

interface ItemRow {
  id: number;
  name: string;
  kind: string;
  unit_label: string;
  size_milli: number;
  retail_cents: number;
  wholesale_cents: number;
  qty_milli: number;
  search: string;
}

export default async function SellPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  // `floor_cents` and `cost_cents` are deliberately not selected: for a repacked
  // chemical the floor IS the cost price, and staff must never receive it.
  const rows = all<ItemRow>(
    `SELECT i.id, i.name, i.kind, i.unit_label, i.size_milli,
            i.retail_cents, i.wholesale_cents,
            COALESCE(SUM(m.delta_milli), 0) AS qty_milli,
            LOWER(i.name || ' ' || COALESCE(c.name, '') || ' ' || COALESCE(c.aliases, '')) AS search
       FROM items i
       LEFT JOIN chemicals c ON c.id = i.chemical_id
       LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.active = 1 AND i.sellable = 1
      GROUP BY i.id
      ORDER BY i.name`,
  );

  const items: SellItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind === "finished" ? "finished" : r.kind === "pack" ? "pack" : "other",
    unitLabel: r.unit_label,
    sizeMilli: r.size_milli,
    retailCents: r.retail_cents,
    wholesaleCents: r.wholesale_cents,
    qtyMilli: r.qty_milli,
    search: r.search,
  }));

  const customers: SellCustomer[] = all<{
    id: number;
    name: string;
    kind: "retail" | "wholesale";
    credit_limit_cents: number;
    owed: number;
  }>(
    `SELECT c.id, c.name, c.kind, c.credit_limit_cents,
            COALESCE((SELECT SUM(s.total_cents - s.paid_cents)
                        FROM sales s
                       WHERE s.customer_id = c.id AND s.status = 'completed'), 0) AS owed
       FROM customers c
      WHERE c.active = 1
      ORDER BY c.name`,
  ).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind === "wholesale" ? "wholesale" : "retail",
    limitCents: c.credit_limit_cents,
    outstandingCents: c.owed,
  }));

  return (
    <SellClient
      items={items}
      topSellerIds={topSellerItemIds(6)}
      customers={customers}
      // The counter may still be looking at this page hours later, served from
      // the service worker cache with no network. Stamping the read means a
      // stale stock count can be labelled as stale instead of read as gospel.
      stockAsOf={new Date().toISOString()}
      action={sellAction}
    />
  );
}

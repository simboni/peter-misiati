import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { currentUser, requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import {
  authoriseOwnerPin,
  cartTotal,
  creditStatus,
  lastOrderFor,
  recordSale,
  topSellerItemIds,
  SaleError,
} from "@/lib/sales";
import { buildKit, smallestKitBatch, listFormulas, outputItemsFor } from "@/lib/production";
import { getPrintSettings } from "@/lib/print-settings";
import { formatKes } from "@/lib/units";
import { checkState } from "@/lib/pricing";
import SellClient, {
  type KitChoice,
  type KitOffer,
  type RepeatOrder,
  type SalePayload,
  type SellCustomer,
  type SellItem,
  type SellState,
} from "./sell-client";

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
    // One PIN, one meaning: the owner is standing here and approves this sale.
    // It authorises a below-floor price and credit beyond what was agreed —
    // both are the same decision, made by the same person, about one sale.
    let approvedBy: number | null = null;
    if (payload.ownerPin) {
      approvedBy = authoriseOwnerPin(payload.ownerPin);
      if (!approvedBy) {
        return { status: "pin", message: "That is not an owner's PIN. Ask the owner to approve this sale." };
      }
    }

    /**
     * Credit beyond what the owner agreed needs the owner, in person.
     *
     * This used to be a warning the counter could click past ("Let them take it
     * anyway"), which is not a control — and it only fired for customers who
     * had a limit at all, so an unknown name could take any amount in silence.
     * Now: inside an agreed limit, nobody is asked anything; past it, or with no
     * limit agreed, the sale does not complete without a PIN.
     */
    const customerId = payload.customerId ?? null;
    if (customerId && !approvedBy) {
      const totalCents = cartTotal(
        payload.lines.map((l) => ({ unitPriceCents: l.unitPriceCents, units: l.units })),
      );
      const paidCents = payload.tenders
        .filter((t) => t.method !== "credit")
        .reduce((s, t) => s + t.amountCents, 0);
      const creditCents = totalCents - paidCents;

      if (creditCents > 0) {
        const status = creditStatus(customerId, creditCents);
        if (status?.needsApproval) {
          return {
            status: "pin",
            message: status.noLimitAgreed
              ? `${status.name} has no credit limit agreed, so ${formatKes(creditCents)} on credit ` +
                `needs the owner's PIN. (Set a limit in Debts and this stops being asked.)`
              : `${status.name} owes ${formatKes(status.outstandingCents)} and their limit is ` +
                `${formatKes(status.limitCents)}. This sale takes them to ${formatKes(status.afterCents)}, ` +
                `so it needs the owner's PIN.`,
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
      floorOverrideBy: approvedBy,
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

/**
 * "Same as last time" — what this customer bought on their last completed sale.
 *
 * Only quantities come back. The counter re-prices everything at today's list,
 * because reviving a price agreed three weeks ago would be a way to sell below
 * today's floor with nobody having decided to.
 */
async function lastOrderAction(customerId: number): Promise<RepeatOrder | null> {
  "use server";

  await requireUser();
  const order = lastOrderFor(customerId);
  if (!order) return null;

  return {
    at: order.at,
    lines: order.lines.map((l) => ({ itemId: l.itemId, name: l.name, units: l.units, available: l.available })),
  };
}

/**
 * Build a mix kit: a recipe, at the size the customer wants, as whole packs.
 *
 * **Owner only, deliberately.** Every other door onto formula quantities in this
 * app is owner-only, and a kit picker that let an attendant dial any recipe to
 * any size would be the formula book with extra steps. Selling kits from a staff
 * login is a decision for the owner to make out loud, not one to leak through a
 * convenience feature — flip the guard here when he does.
 */
async function kitAction(versionId: number, targetMilli: number): Promise<KitOffer | null> {
  "use server";

  const user = await requireUser();
  if (user.role !== "owner") return null;

  const kit = buildKit(versionId, targetMilli);
  // What batch size WOULD work, so a refusal comes with an answer attached.
  const floor = smallestKitBatch(versionId);
  return {
    formulaName: kit.formulaName,
    targetMilli: kit.targetMilli,
    floorMilli: floor.targetMilli,
    floorBecause: floor.binding?.name ?? null,
    unpackable: floor.unpackable,
    ingredients: kit.ingredients.map((i) => ({
      chemicalName: i.chemicalName,
      unit: i.unit,
      neededMilli: i.neededMilli,
      suppliedMilli: i.suppliedMilli,
      missing: i.missing,
      oversized: i.oversized,
      picks: i.picks.map((p) => ({ itemId: p.itemId, name: p.name, units: p.units })),
    })),
  };
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

  /**
   * Which finished products the shop can also sell as their ingredients.
   *
   * Keyed by the finished item, because that is what the counter taps. A
   * product and its recipe share a name once the pack size is stripped —
   * "Shampoo — 500 ml" is made by the "Shampoo" formula — which is the same
   * join `outputItemsFor` uses when a batch is bottled.
   *
   * Owner only, and empty for staff, which is what keeps the recipe off their
   * screen: with no entry here a tile renders as an ordinary product.
   */
  const makeable: Record<number, { versionId: number; refSizeMilli: number; formulaName: string }> =
    user.role === "owner"
      ? Object.fromEntries(
          listFormulas().flatMap((f) =>
            outputItemsFor(f.name)
              .filter((o) => o.suggested)
              .map((o) => [
                o.id,
                { versionId: f.version_id, refSizeMilli: f.ref_size_milli, formulaName: f.name },
              ]),
          ),
        )
      : {};

  const kits: KitChoice[] =
    user.role === "owner"
      ? listFormulas().map((f) => ({
          versionId: f.version_id,
          name: f.name,
          refSizeMilli: f.ref_size_milli,
        }))
      : [];

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
      isOwner={user.role === "owner"}
      // The shop's letterhead only — nothing owner-sensitive — so a queued
      // sale can print or PDF a receipt entirely on the phone, with no
      // server to ask, before the till has ever seen the sale.
      printer={getPrintSettings()}
      // The recipe list itself is owner-only, so staff are handed an empty one
      // rather than a picker that would refuse them after the click.
      kits={kits}
      makeable={makeable}
      onLastOrder={lastOrderAction}
      onKit={kitAction}
      // The counter may still be looking at this page hours later, served from
      // the service worker cache with no network. Stamping the read means a
      // stale stock count can be labelled as stale instead of read as gospel.
      stockAsOf={new Date().toISOString()}
      // Whether anyone has looked at prices today. Chemical prices move with
      // the supplier, and selling all morning on last week's is how the shop
      // loses money quietly — so the till says so once, at the top, and links
      // to the one screen that fixes it.
      pricesCheckedToday={checkState().doneToday}
      action={sellAction}
    />
  );
}

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
import { mixFor, listFormulas } from "@/lib/production";
import { getPrintSettings } from "@/lib/print-settings";
import { formatKes } from "@/lib/units";
import { checkState } from "@/lib/pricing";
import SellClient, {
  type MixOffer,
  type RecipeChoice,
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
 * below the item's floor unless an owner PIN came with it, refuses tenders
 * that overshoot the bill, and refuses a weighed quantity larger than the
 * ledger says is in the store.
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
        payload.lines.map((l) => ({
          unitPriceCents: l.unitPriceCents,
          units: l.units,
          basis: l.basis,
          qtyMilli: l.qtyMilli,
        })),
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
    lines: order.lines.map((l) => ({
      itemId: l.itemId,
      name: l.name,
      units: l.units,
      qtyMilli: l.qtyMilli,
      weighed: l.weighed,
      available: l.available,
    })),
  };
}

/**
 * Price a recipe up as the chemicals that go into it.
 *
 * **Open to attendants, unlike the kit builder it replaces.** That was
 * owner-only to keep recipe quantities off a staff screen, and there is no
 * longer anything to keep: the shop sells the mix as its ingredients, so the
 * quantities are printed on the customer's own receipt. A rule that hides a
 * number from the person at the counter while handing it to whoever walks in is
 * not protecting anything — it only stops the sale from being made.
 *
 * If the owner would rather this stayed his alone, the guard goes back here,
 * and the Products board simply stops appearing for staff.
 */
async function mixAction(
  versionId: number,
  targetMilli: number,
  tier: "retail" | "wholesale",
): Promise<MixOffer | null> {
  "use server";

  await requireUser();
  if (!Number.isFinite(targetMilli) || targetMilli <= 0) return null;

  const mix = mixFor(versionId, Math.round(targetMilli), tier);
  return {
    versionId: mix.versionId,
    formulaName: mix.formulaName,
    targetMilli: mix.targetMilli,
    totalCents: mix.totalCents,
    sellable: mix.sellable,
    possibleMilli: mix.possibleMilli,
    ingredients: mix.ingredients.map((i) => ({
      itemId: i.itemId,
      chemicalName: i.chemicalName,
      unit: i.unit,
      qtyMilli: i.qtyMilli,
      rateCents: i.rateCents,
      amountCents: i.amountCents,
      availableMilli: i.availableMilli,
      unlisted: i.unlisted,
      unpriced: i.unpriced,
      short: i.short,
    })),
  };
}

interface ItemRow {
  id: number;
  name: string;
  kind: string;
  price_basis: "pack" | "unit";
  canonical_unit: "kg" | "L" | "pcs";
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

  // `floor_cents` and `cost_cents` are deliberately not selected: a chemical's
  // floor sits close to its cost price, and staff must never receive cost.
  const rows = all<ItemRow>(
    `SELECT i.id, i.name, i.kind, i.price_basis, i.canonical_unit, i.unit_label, i.size_milli,
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
    basis: r.price_basis === "unit" ? "unit" : "pack",
    unit: r.canonical_unit,
    name: r.name,
    unitLabel: r.unit_label,
    sizeMilli: r.size_milli,
    retailCents: r.retail_cents,
    wholesaleCents: r.wholesale_cents,
    qtyMilli: r.qty_milli,
    search: r.search,
  }));

  /**
   * The recipe board.
   *
   * A formula is not a thing on a shelf — it is a shopping list the counter can
   * fill in one tap. Tapping one asks how much the customer is making and bills
   * the chemicals for it, which is the whole of what the shop means by selling
   * a product now.
   */
  const recipes: RecipeChoice[] = listFormulas()
    .filter((f) => f.ingredient_count > 0)
    .map((f) => ({
      versionId: f.version_id,
      name: f.name,
      refSizeMilli: f.ref_size_milli,
      ingredientCount: f.ingredient_count,
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
      isOwner={user.role === "owner"}
      // The shop's letterhead only — nothing owner-sensitive — so a queued
      // sale can print or PDF a receipt entirely on the phone, with no
      // server to ask, before the till has ever seen the sale.
      printer={getPrintSettings()}
      recipes={recipes}
      onLastOrder={lastOrderAction}
      onMix={mixAction}
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

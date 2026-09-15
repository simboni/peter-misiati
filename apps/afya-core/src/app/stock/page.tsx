import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import {
  listStores, stockPosition, reorderReport, expiryReport, stockValue, controlledRegister,
} from "@/lib/inventory.ts";
import { formatKes } from "@/lib/billing.ts";
import { Shell, Stat, Section, Empty } from "@/app/_components/shell.tsx";
import { receiveStockAction } from "@/app/pharmacy/actions.ts";
import { FORMULARY_STARTER } from "@/lib/seed.ts";

/**
 * Stores.
 *
 * Four questions on one screen because a facility that has to open four screens
 * checks none of them: what is there, what runs out, what expires, and what the
 * Pharmacy and Poisons Board will ask to see.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const { store: requested } = await searchParams;
  const stores = listStores(user.facilityId);
  // Default to the dispensing point: it is where the stock a clinic worries
  // about actually sits, and opening on an empty main store reads as a system
  // with no stock in it.
  const store =
    stores.find((s) => s.code === requested?.toUpperCase()) ??
    stores.find((s) => s.dispensing) ??
    stores[0];
  if (!store) {
    return (
      <Shell user={user} current="/stock" title="Stores">
        <Empty>No store is configured for this facility.</Empty>
      </Shell>
    );
  }

  const position = stockPosition(store.code);
  const reorder = reorderReport(store.code);
  const expiring = expiryReport(store.code, 90);
  const value = stockValue(store.code);
  const register = controlledRegister({ storeCode: store.code }).slice(-15).reverse();

  return (
    <Shell
      user={user}
      current="/stock"
      title="Stores"
      subtitle={`${store.name}${store.dispensing ? " — dispensing point" : ""}`}
      actions={stores.map((s) => (
        <a
          key={s.code}
          href={`/stock?store=${s.code}`}
          className={`font-semibold rounded px-4 py-2 text-sm ${
            s.code === store.code ? "bg-brand text-white" : "border border-line"
          }`}
        >
          {s.name}
        </a>
      ))}
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Value on the shelf" value={formatKes(value.valueCents)} note={`${value.lines} batches`} />
        <Stat
          label="To reorder"
          value={reorder.order.length}
          tone={reorder.order.length > 0 ? "clock" : "good"}
          note="at or below the level"
        />
        <Stat
          label="No level set"
          value={reorder.noLevelSet.length}
          tone={reorder.noLevelSet.length > 0 ? "muted" : "good"}
          note="a decision nobody has made"
        />
        <Stat
          label="Expiring in 90 days"
          value={expiring.length}
          tone={expiring.length > 0 ? "clock" : "good"}
          note="batches"
        />
      </div>

      <Section title="Take delivery" note="A batch number and an expiry date are not optional.">
        <form action={receiveStockAction} className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="storeCode" value={store.code} />
          <label className="text-xs text-muted">
            Product
            <select name="productCode" className="block w-56 border border-line rounded px-2 py-1.5 text-sm bg-white">
              {FORMULARY_STARTER.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Batch
            <input
              name="batchNumber"
              required
              placeholder="PA-1042"
              className="block w-32 border border-line rounded px-2 py-1.5 text-sm font-mono bg-white"
            />
          </label>
          <label className="text-xs text-muted">
            Expires
            <input
              name="expiresOn"
              type="date"
              required
              className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
            />
          </label>
          <label className="text-xs text-muted">
            Quantity
            <input
              name="quantity"
              type="number"
              min={1}
              required
              className="block w-24 border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
            />
          </label>
          <label className="text-xs text-muted">
            Unit cost (KES)
            <input
              name="unitCost"
              type="number"
              step="0.01"
              min={0}
              className="block w-28 border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
            />
          </label>
          <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
            Receive
          </button>
        </form>
      </Section>

      <Section title="Stock position">
        {position.length === 0 ? (
          <Empty>Nothing has been received into this store yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium text-right">On hand</th>
                  <th className="px-3 py-2 font-medium text-right">Reorder at</th>
                  <th className="px-3 py-2 font-medium text-right">Order</th>
                  <th className="px-3 py-2 font-medium text-right">Next expiry</th>
                  <th className="px-3 py-2 font-medium text-right">Locked / expired</th>
                </tr>
              </thead>
              <tbody>
                {position.map((line) => (
                  <tr key={line.productCode} className="border-t border-line">
                    <td className="px-3 py-2">
                      {line.productName}
                      {line.controlled ? (
                        <span className="ml-2 text-[11px] font-bold uppercase tracking-wide bg-brand-soft text-brand-dark rounded px-1.5 py-0.5">
                          Controlled
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tnum font-semibold ${
                        line.reorderAt !== null && line.onHand <= line.reorderAt ? "text-clock" : ""
                      }`}
                    >
                      {line.onHand}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-muted">
                      {line.reorderAt ?? <span className="text-muted">not set</span>}
                    </td>
                    <td className="px-3 py-2 text-right tnum font-semibold text-clock">
                      {line.orderQuantity ? line.orderQuantity : ""}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-muted">{line.nextExpiry ?? "—"}</td>
                    <td className="px-3 py-2 text-right tnum text-muted">
                      {line.quarantined || line.expired
                        ? `${line.quarantined} / ${line.expired}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Controlled drug register"
        note="Every movement of a controlled product, in date order. This is what the PPB inspects."
      >
        {register.length === 0 ? (
          <Empty>No controlled product has moved in this store.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Batch</th>
                  <th className="px-3 py-2 font-medium">Movement</th>
                  <th className="px-3 py-2 font-medium text-right">Quantity</th>
                  <th className="px-3 py-2 font-medium text-right">Balance</th>
                  <th className="px-3 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {register.map((m) => (
                  <tr key={m.id} className="border-t border-line">
                    <td className="px-3 py-2 tnum text-muted">{m.at.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3 py-2">{m.product_name}</td>
                    <td className="px-3 py-2 font-mono text-xs tnum">{m.batch_number}</td>
                    <td className="px-3 py-2 text-muted">{m.kind.replace("_", " ")}</td>
                    <td className={`px-3 py-2 text-right tnum ${m.quantity < 0 ? "text-block" : "text-good"}`}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="px-3 py-2 text-right tnum font-semibold">{m.balance_after}</td>
                    <td className="px-3 py-2 font-mono text-xs tnum">{m.patient_mrn ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{m.by_user_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </Shell>
  );
}

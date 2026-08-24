import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  listSuppliers,
  recentPurchases,
  purchaseLines,
  priceHistory,
  purchasedItems,
  buyableItems,
  supplierSpend,
} from "@/lib/purchasing";
import { formatKes, formatDate, formatDateTime, formatUnits, pct } from "@/lib/units";
import { Card, PageTitle, SectionLabel, Chip, Stat, Empty, TableWrap, Th, Td, Alert } from "@/components/ui";
import { SupplierForm, PurchaseForm, ItemPicker } from "./forms";

export const dynamic = "force-dynamic";

/**
 * Suppliers and deliveries.
 *
 * Everything on this page that carries a price is behind `isOwner()`, checked
 * on the server: staff can see who supplies what and call them, but purchase
 * prices, supplier spend and the cost-price history are the owner's alone.
 */
export default async function PurchasesPage(props: { searchParams: Promise<{ item?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const owner = user.role === "owner";

  // `searchParams` is a Promise in Next.js 16 — synchronous access was removed.
  const { item } = await props.searchParams;

  const suppliers = listSuppliers();

  if (!owner) {
    return (
      <div>
        <PageTitle title="Suppliers" subtitle="Who to call when something runs out" />
        <div className="max-w-4xl">
          <Alert tone="warn">
            Purchase prices are the owner&apos;s. Ask him to record deliveries — you can still keep
            the supplier list up to date here.
          </Alert>
        </div>
        <SupplierList suppliers={suppliers} />
        <SectionLabel>Add a supplier</SectionLabel>
        <Card className="max-w-2xl">
          <SupplierForm />
        </Card>
      </div>
    );
  }

  // ------------------------------------------------------------ owner view
  const purchases = recentPurchases(20);
  const spend = supplierSpend();
  const bought = purchasedItems();
  const items = buyableItems();

  const watchedId = item ? Number(item) : bought[0]?.id;
  const history = watchedId ? priceHistory(watchedId) : [];
  const watched = bought.find((b) => b.id === watchedId);

  // The move since the previous delivery is the number that decides whether the
  // shelf price has to change this week.
  const latest = history[0];
  const previous = history[1];
  const swing = latest && previous ? pct(latest.unit_cost_cents - previous.unit_cost_cents, previous.unit_cost_cents) : 0;

  const spent30 = purchases
    .filter((p) => Date.now() - new Date(p.at.replace(" ", "T") + "Z").getTime() < 30 * 86_400_000)
    .reduce((s, p) => s + p.total_cents, 0);

  return (
    <div>
      <PageTitle title="Suppliers & purchases" subtitle="Deliveries in, landed cost out" />

      {/* Two tiles only — capped so they stay tile-sized instead of stretching
          into two half-empty billboards on an office monitor. */}
      <div className="grid grid-cols-2 gap-3 xl:max-w-2xl">
        <Stat label="Spent, last 30 days" value={formatKes(spent30)} detail={`${purchases.length} recent deliveries`} />
        <Stat label="Suppliers" value={String(suppliers.length)} detail="on the list" />
      </div>

      <SectionLabel>Record a delivery</SectionLabel>
      <Card className="max-w-3xl xl:max-w-5xl">
        <PurchaseForm suppliers={suppliers} items={items} />
      </Card>

      <SectionLabel>Price history</SectionLabel>
      {bought.length ? (
        <Card className="space-y-3">
          <ItemPicker items={bought} selected={watchedId} />

          {watched ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold">{watched.name}</span>
                {latest && previous ? (
                  <Chip tone={swing > 0 ? "bad" : swing < 0 ? "good" : "neutral"}>
                    {swing > 0 ? "+" : ""}
                    {swing.toFixed(1)}% since last time
                  </Chip>
                ) : null}
              </div>

              <TableWrap>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Supplier</Th>
                    <Th align="right">Units</Th>
                    <Th align="right">Each</Th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.purchase_id + "-" + h.at}>
                      <Td>{formatDate(h.at)}</Td>
                      <Td>{h.supplier_name ?? "—"}</Td>
                      <Td align="right">{h.units}</Td>
                      <Td align="right" className="font-semibold">
                        {formatKes(h.unit_cost_cents)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <p className="text-xs text-muted">
                Landed cost per container — the invoice price plus that line&apos;s share of transport.
              </p>
            </>
          ) : (
            <Empty>Pick an item to see what it has cost over time.</Empty>
          )}
        </Card>
      ) : (
        <Card>
          <Empty>No deliveries recorded yet. The first one starts the price history.</Empty>
        </Card>
      )}

      <SectionLabel>Recent deliveries</SectionLabel>
      {purchases.length ? (
        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
          {/* `min-w-0` on each card: a grid item defaults to min-width:auto, so
              the card grew to fit its widest delivery line instead of that line
              truncating inside it, and on a 360px phone the whole page went 70px
              past its own edge. */}
          {purchases.map((p) => (
            <Card key={p.id} className="min-w-0 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-bold">{p.supplier_name ?? "Supplier not recorded"}</div>
                  <div className="text-xs text-muted">
                    {formatDateTime(p.at)}
                    {p.ref ? ` · ${p.ref}` : ""}
                    {p.user_name ? ` · ${p.user_name}` : ""}
                  </div>
                </div>
                {/* Not `shrink-0`: "incl. KES 1,234 transport" is long, and a
                    column that can neither shrink nor wrap pushed a 360px phone
                    29px past its own edge. The total still never wraps. */}
                <div className="min-w-0 text-right">
                  <div className="whitespace-nowrap font-extrabold tnum">{formatKes(p.total_cents)}</div>
                  {p.transport_cents ? (
                    <div className="text-[11px] leading-tight text-muted">
                      incl. {formatKes(p.transport_cents)} transport
                    </div>
                  ) : null}
                </div>
              </div>
              <ul className="space-y-0.5 border-t border-line pt-2 text-xs">
                {purchaseLines(p.id).map((l) => (
                  <li key={l.id} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-muted">
                      {l.item_name} · {formatUnits(l.qty_milli, l.size_milli, l.unit_label)}
                    </span>
                    <span className="shrink-0 tnum">{formatKes(l.cost_cents)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Empty>Nothing bought in yet.</Empty>
        </Card>
      )}

      <SectionLabel>Supplier spend</SectionLabel>
      <TableWrap>
        <thead>
          <tr>
            <Th>Supplier</Th>
            <Th align="right">Deliveries</Th>
            <Th align="right">Spend</Th>
          </tr>
        </thead>
        <tbody>
          {spend.map((s) => (
            <tr key={s.id}>
              <Td>
                <div className="font-semibold">{s.name}</div>
                <div className="text-[11px] text-muted">
                  {s.phone || "no phone"}
                  {s.last_at ? ` · last ${formatDate(s.last_at)}` : ""}
                </div>
              </Td>
              <Td align="right">{s.deliveries}</Td>
              <Td align="right" className="font-semibold">
                {formatKes(s.spend_cents)}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <SectionLabel>Suppliers</SectionLabel>
      <SupplierList suppliers={suppliers} />

      <SectionLabel>Add a supplier</SectionLabel>
      <Card className="max-w-2xl">
        <details>
          <summary className="cursor-pointer text-sm font-bold text-brand">New supplier</summary>
          <div className="mt-3">
            <SupplierForm />
          </div>
        </details>
      </Card>
    </div>
  );
}

function SupplierList({
  suppliers,
}: {
  suppliers: Array<{ id: number; name: string; phone: string; note: string }>;
}) {
  if (!suppliers.length) {
    return (
      <Card>
        <Empty>No suppliers yet.</Empty>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
      {/* `min-w-0` for the same reason as the deliveries above: a grid item
          grows to fit its widest child unless told it may shrink, and a long
          supplier name plus a phone number overran a 320px phone. */}
      {suppliers.map((s) => (
        <Card key={s.id} className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-bold">{s.name}</div>
              {s.note ? <div className="text-xs text-muted">{s.note}</div> : null}
            </div>
            {s.phone ? (
              <a
                href={`tel:${s.phone.replace(/\s/g, "")}`}
                className="-my-2 inline-flex min-h-11 shrink-0 items-center whitespace-nowrap py-2 text-xs font-bold text-brand sm:min-h-0 sm:py-0"
              >
                {s.phone}
              </a>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

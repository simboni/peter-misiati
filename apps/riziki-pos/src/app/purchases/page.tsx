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
import { formatKes, formatDate, formatDateTime, formatUnits, formatQty, pct } from "@/lib/units";
import { Card, PageTitle, SectionLabel, Chip, Stat, Empty, TableWrap, Th, Td, Alert } from "@/components/ui";
import { Pager } from "@/components/section-nav";
import { ExportButtons } from "@/components/export-buttons";
import { SupplierForm, PurchaseForm, ItemPicker } from "./forms";

export const dynamic = "force-dynamic";

/**
 * Rows per page, for both lists on this screen.
 *
 * Ten rather than fifteen: a delivery row carries its lines underneath it, so
 * ten of them is already a screenful, and the supplier list matching it keeps
 * the two pagers on the page behaving the same way.
 */
const PER_PAGE = 10;

/**
 * Suppliers and deliveries.
 *
 * Everything on this page that carries a price is behind `isOwner()`, checked
 * on the server: staff can see who supplies what and call them, but purchase
 * prices, supplier spend and the cost-price history are the owner's alone.
 */
export default async function PurchasesPage(props: {
  searchParams: Promise<{ item?: string; dp?: string; sp?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const owner = user.role === "owner";

  // `searchParams` is a Promise in Next.js 16 — synchronous access was removed.
  // `dp` pages the deliveries and `sp` the suppliers: two lists on one screen
  // need two page numbers, or turning one turns the other.
  const { item, dp, sp } = await props.searchParams;
  const requestedSupplierPage = Math.max(1, Number(sp) || 1);

  const suppliers = listSuppliers();

  if (!owner) {
    return (
      <div>
        <PageTitle title="Suppliers" subtitle="Who to call when something runs out" />
        <div className="max-w-4xl">
          <Alert tone="warn">
            Purchase prices are the owner’s. Ask him to record deliveries — you can still keep
            the supplier list up to date here.
          </Alert>
        </div>
        <SupplierList suppliers={suppliers} page={requestedSupplierPage} item={item} />
        <SectionLabel>Add a supplier</SectionLabel>
        <Card className="max-w-2xl">
          <SupplierForm />
        </Card>
      </div>
    );
  }

  // ------------------------------------------------------------ owner view
  const purchases = recentPurchases(200);
  const deliveryPages = Math.max(1, Math.ceil(purchases.length / PER_PAGE));
  const deliveryPage = Math.min(Math.max(1, Number(dp) || 1), deliveryPages);
  const shownPurchases = purchases.slice(
    (deliveryPage - 1) * PER_PAGE,
    deliveryPage * PER_PAGE,
  );

  const spend = supplierSpend();
  const supplierPages = Math.max(1, Math.ceil(spend.length / PER_PAGE));
  const supplierPage = Math.min(requestedSupplierPage, supplierPages);
  const shownSpend = spend.slice((supplierPage - 1) * PER_PAGE, supplierPage * PER_PAGE);

  /*
    What each pager must carry for the other one.

    Two lists on one screen means two page numbers in the URL, and a pager that
    writes only its own throws the other away — turning to the second page of
    suppliers sent the deliveries back to page one, halfway up the same screen.
    Page one is left out so the common URL stays clean.
  */
  const keeping = (extra: Record<string, number>) => {
    const out: Record<string, string> = item ? { item } : {};
    for (const [k, v] of Object.entries(extra)) if (v > 1) out[k] = String(v);
    return out;
  };

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

  const last30 = purchases.filter(
    (p) => Date.now() - new Date(p.at.replace(" ", "T") + "Z").getTime() < 30 * 86_400_000,
  );
  const spent30 = last30.reduce((s, p) => s + p.total_cents, 0);

  return (
    <div>
      <PageTitle title="Suppliers & purchases" subtitle="Deliveries in, landed cost out" />

      <div className="mb-3">
        <ExportButtons csv="purchases" label="the purchase record" />
      </div>

      {/* Two tiles only — capped so they stay tile-sized instead of stretching
          into two half-empty billboards on an office monitor. */}
      <div className="grid grid-cols-2 gap-3 xl:max-w-2xl">
        <Stat
          label="Spent, last 30 days"
          value={formatKes(spent30)}
          detail={`${last30.length} ${last30.length === 1 ? "delivery" : "deliveries"}`}
        />
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
                    <Th align="right">Per {watched.canonical_unit}</Th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.purchase_id + "-" + h.at}>
                      <Td>{formatDate(h.at)}</Td>
                      <Td>{h.supplier_name ?? "—"}</Td>
                      <Td align="right">
                        {h.units}
                        {h.size_milli > 0 ? (
                          <span className="text-muted">
                            {" × "}
                            {formatQty(h.size_milli, watched.canonical_unit)}
                          </span>
                        ) : null}
                      </Td>
                      <Td align="right" className="font-semibold">
                        {formatKes(h.unit_cost_cents)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <p className="text-xs text-muted">
                {/* The explicit {" "} is not optional: this compiler drops the
                    leading whitespace of a text chunk that follows an
                    expression across a line break, and "Per kgand not per drum"
                    is what reaches the owner. See AGENTS.md. */}
                Landed cost per {watched.canonical_unit} — the invoice price plus that line’s
                share of transport, over the weight that actually arrived. Per{" "}
                {watched.canonical_unit} and not per drum, so a smaller drum does not read as a
                cheaper delivery.
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
        /*
          A delivery is a date, a supplier and a total, with the lines under it.

          It was a card each, which put four deliveries on a laptop screen and
          made "what did we pay Kel last month" a scroll rather than a read.
          A row per delivery lines the totals up under each other; the lines
          that made up the delivery stay, indented under the supplier, because
          a total with no idea what it bought is not worth showing.
        */
        <div id="deliveries">
          <TableWrap>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Supplier & what came in</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {shownPurchases.map((p) => (
                <tr key={p.id} className="align-top hover:bg-wash/50">
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(p.at)}</Td>
                  <Td>
                    <div className="font-bold">{p.supplier_name ?? "Supplier not recorded"}</div>
                    {p.ref || p.user_name ? (
                      <div className="text-[11px] text-muted">
                        {[p.ref, p.user_name].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                    <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
                      {purchaseLines(p.id).map((l) => (
                        <li key={l.id}>
                          {/* The drum, not just the count. Ufacid comes in 250 kg
                              and 200 kg drums, so "3 drums" on its own does not
                              say what arrived — and this line is what gets
                              checked against the delivery note months later. */}
                          {l.item_name} · {formatUnits(l.qty_milli, l.size_milli, l.unit_label)}
                          {l.size_milli > 0
                            ? ` of ${formatQty(l.size_milli, l.canonical_unit)} · ${formatQty(l.qty_milli, l.canonical_unit)}`
                            : ""}{" "}
                          · {formatKes(l.cost_cents)}
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td align="right">
                    <span className="whitespace-nowrap font-extrabold tnum">
                      {formatKes(p.total_cents)}
                    </span>
                    {p.transport_cents ? (
                      <div className="text-[11px] leading-tight text-muted">
                        incl. {formatKes(p.transport_cents)} transport
                      </div>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          <Pager
            action="/purchases"
            param="dp"
            anchor="#deliveries"
            page={deliveryPage}
            pages={deliveryPages}
            total={purchases.length}
            noun="delivery"
            plural="deliveries"
            params={keeping({ sp: supplierPage })}
          />
        </div>
      ) : (
        <Card>
          <Empty>Nothing bought in yet.</Empty>
        </Card>
      )}

      {/*
        One supplier list, not two.

        There were two: a "Supplier spend" table and a "Suppliers" roll of
        names underneath it, holding the same people in a different order — so
        "have we used Kel before, and what's their number" was two lookups and
        two answers. `supplierSpend` LEFT JOINs, so a supplier who has never
        delivered is in here too, with zeroes. Biggest spend first, because
        that is the supplier whose price matters most.
      */}
      <SectionLabel>Suppliers</SectionLabel>
      <div id="suppliers">
        <TableWrap>
          <thead>
            <tr>
              <Th>Supplier</Th>
              <Th align="right">Phone</Th>
              <Th align="right">Deliveries</Th>
              <Th align="right">Spend</Th>
            </tr>
          </thead>
          <tbody>
            {shownSpend.map((s) => (
              <tr key={s.id} className="hover:bg-wash/50">
                <Td>
                  <div className="font-bold">{s.name}</div>
                  {s.note || s.last_at ? (
                    <div className="text-[11px] text-muted">
                      {[s.note, s.last_at ? `last ${formatDate(s.last_at)}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  ) : null}
                </Td>
                <Td align="right">
                  {s.phone ? (
                    <a
                      href={`tel:${s.phone.replace(/\s/g, "")}`}
                      className="-my-2 inline-flex min-h-11 items-center whitespace-nowrap py-2 text-xs font-bold text-brand xl:min-h-0 xl:py-0"
                    >
                      {s.phone}
                    </a>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td align="right">{s.deliveries || <span className="text-muted">—</span>}</Td>
                <Td align="right" className="font-semibold">
                  {s.spend_cents ? formatKes(s.spend_cents) : <span className="text-muted">—</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>

        <Pager
          action="/purchases"
          param="sp"
          anchor="#suppliers"
          order="list"
          page={supplierPage}
          pages={supplierPages}
          total={spend.length}
          noun="supplier"
          params={keeping({ dp: deliveryPage })}
        />
      </div>

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

/**
 * The supplier list.
 *
 * A column of names with a phone number beside each, because the errand this
 * screen exists for is "something ran out, who do I ring". The number stays a
 * `tel:` link with a full-height touch target — on the phone in the shop that
 * link is the whole point of the row.
 */
function SupplierList({
  suppliers,
  page,
  item,
}: {
  suppliers: Array<{ id: number; name: string; phone: string; note: string }>;
  page: number;
  item?: string;
}) {
  if (!suppliers.length) {
    return (
      <Card>
        <Empty>No suppliers yet.</Empty>
      </Card>
    );
  }

  const pages = Math.max(1, Math.ceil(suppliers.length / PER_PAGE));
  const current = Math.min(page, pages);
  const shown = suppliers.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  return (
    <div id="suppliers">
      <TableWrap>
        <thead>
          <tr>
            <Th>Supplier</Th>
            <Th align="right">Phone</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.id} className="hover:bg-wash/50">
              <Td>
                <div className="font-bold">{s.name}</div>
                {s.note ? <div className="text-[11px] text-muted">{s.note}</div> : null}
              </Td>
              <Td align="right">
                {s.phone ? (
                  <a
                    href={`tel:${s.phone.replace(/\s/g, "")}`}
                    className="-my-2 inline-flex min-h-11 items-center whitespace-nowrap py-2 text-xs font-bold text-brand xl:min-h-0 xl:py-0"
                  >
                    {s.phone}
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <Pager
        action="/purchases"
        param="sp"
        anchor="#suppliers"
        order="list"
        page={current}
        pages={pages}
        total={suppliers.length}
        noun="supplier"
        params={item ? { item } : {}}
      />
    </div>
  );
}

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  procurementSummary, pendingRequisitions, openOrders, orderLog, invoicesToSettle,
  listSuppliers, getRequisition, requisitionLines, quotationsFor,
  getPurchaseOrder, poLines, deliveriesFor, deliveryLines, canSupplyMedicines,
  EXPECTED_QUOTATIONS,
} from "@/lib/procurement.ts";
import { listStores } from "@/lib/inventory.ts";
import { formatKes } from "@/lib/billing.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  requisitionAction, decideAction, quotationAction, selectAction,
  orderAction, cancelOrderAction, receiveAction, invoiceAction,
  matchAction, approveInvoiceAction, payAction, supplierAction, blockAction,
} from "./actions.ts";

/**
 * Procurement.
 *
 * Four views along the chain: what was asked for, what was ordered, what is
 * owed, and who we buy from. The invoice view is the one that matters — it is
 * where the three-way match shows its working.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; r?: string; p?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "report.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "requisitions";
  const acting = can(user.userId, "report.read");
  const configuring = can(user.userId, "facility.configure");

  const summary = procurementSummary(user.facilityId);
  const requisitions = pendingRequisitions(user.facilityId);
  const open = openOrders(user.facilityId);
  const log = orderLog(user.facilityId, 30);
  const invoices = invoicesToSettle(user.facilityId);
  const suppliers = listSuppliers(true);
  const stores = listStores(user.facilityId);

  const openReq = params.r ? getRequisition(params.r) : undefined;
  const openReqLines = openReq ? requisitionLines(openReq.id) : [];
  const quotes = openReq ? quotationsFor(openReq.id) : [];

  const openPo = params.p ? getPurchaseOrder(params.p) : undefined;
  const openPoRow = openPo ? [...open, ...log].find((r) => r.po.id === openPo.id) : undefined;
  const openPoLines = openPo ? poLines(openPo.id) : [];
  const openDeliveries = openPo ? deliveriesFor(openPo.id) : [];

  const href = (v: string) => (v === "requisitions" ? "/procurement" : `/procurement?view=${v}`);

  return (
    <Shell
      user={user}
      current={href(view)}
      error={params.error}
      title={
        view === "orders" ? "Purchase orders"
        : view === "invoices" ? "Invoices & the match"
        : view === "suppliers" ? "Suppliers"
        : "Requisitions"
      }
      subtitle={
        view === "invoices"
          ? "Every invoice checked line by line against what was ordered and what arrived. You cannot pay for more than arrived, or at more than was agreed."
          : view === "requisitions"
            ? "The person who raises a requisition cannot approve it."
            : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "requisitions", label: "Requisitions", href: "/procurement" },
          { key: "orders", label: "Orders", href: "/procurement?view=orders" },
          { key: "invoices", label: "Invoices", href: "/procurement?view=invoices" },
          { key: "suppliers", label: "Suppliers", href: "/procurement?view=suppliers" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Waiting for approval"
          value={summary.requisitionsWaiting}
          tone={summary.requisitionsWaiting > 0 ? "clock" : "good"}
          note={`${summary.openOrders} orders open`}
        />
        <Stat
          label="Committed"
          value={formatKes(summary.committedCents)}
          tone={summary.lateOrders > 0 ? "clock" : "ink"}
          note={`${summary.lateOrders} orders past their date`}
        />
        <Stat
          label="Invoices queried"
          value={summary.queriedInvoices}
          tone={summary.queriedInvoices > 0 ? "block" : "good"}
          note={summary.varianceCents > 0 ? `${formatKes(summary.varianceCents)} overcharged` : "nothing overcharged"}
        />
        <Stat
          label="Paid"
          value={formatKes(summary.paidCents)}
          tone="ink"
          note={summary.withoutEtims > 0 ? `${summary.withoutEtims} invoices with no eTIMS number` : "all with eTIMS numbers"}
        />
      </div>

      {/* ============================================== requisitions */}
      {view === "requisitions" ? (
        <>
          <Section title="Requisitions" note="What the stores have asked for, and who approved it.">
            {requisitions.length === 0 ? (
              <Empty>Nothing is waiting.</Empty>
            ) : (
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Raised</th>
                    <th className="px-3 py-2 font-medium">Store</th>
                    <th className="px-3 py-2 font-medium">Why</th>
                    <th className="px-3 py-2 font-medium">By</th>
                    <th className="px-3 py-2 font-medium text-right">Lines</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {requisitions.map((r) => (
                    <tr key={r.id} className={`border-t border-line ${r.status === "raised" ? "bg-clock-soft" : ""} ${r.id === openReq?.id ? "bg-brand-soft" : ""}`}>
                      <td className="px-3 py-2 tnum text-muted">{r.raised_at.slice(0, 10)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.store_code}</td>
                      <td className="px-3 py-2">{r.reason}</td>
                      <td className="px-3 py-2 text-muted text-xs">{r.raiser_name}</td>
                      <td className="px-3 py-2 text-right tnum">{r.lines}</td>
                      <td className={`px-3 py-2 text-xs font-semibold capitalize ${r.status === "raised" ? "text-clock" : "text-good"}`}>
                        {r.status}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a href={`/procurement?r=${r.id}`} className="text-brand underline underline-offset-2 text-xs">Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {openReq ? (
            <Section
              title={`${openReq.reason} — ${openReq.store_code}`}
              note={`Raised by ${openReq.raiser_name} on ${openReq.raised_at.slice(0, 10)}${
                openReq.approver_name ? ` · ${openReq.status} by ${openReq.approver_name}` : ""
              }`}
            >
              <table className="w-full text-sm bg-white border border-line rounded mb-4">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium text-right">Asked for</th>
                    <th className="px-3 py-2 font-medium text-right">Had at the time</th>
                    <th className="px-3 py-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {openReqLines.map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-3 py-2">{l.product_name} <span className="font-mono text-xs text-muted ml-1">{l.product_code}</span></td>
                      <td className="px-3 py-2 text-right tnum font-semibold">{l.quantity}</td>
                      <td className="px-3 py-2 text-right tnum text-muted">{l.on_hand_then ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted">{l.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {openReq.status === "raised" && acting ? (
                openReq.raised_by === user.userId ? (
                  <p className="text-sm text-clock font-semibold mb-4">
                    You raised this one. Somebody else has to approve it — that is the whole point of approval.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 mb-4">
                    {(["approve", "reject"] as const).map((decision) => (
                      <form action={decideAction} key={decision} className="bg-white border border-line rounded p-3">
                        <input type="hidden" name="requisitionId" value={openReq.id} />
                        <input type="hidden" name="decision" value={decision} />
                        <p className="text-sm font-semibold mb-2 capitalize">{decision}</p>
                        <input name="note" placeholder={decision === "reject" ? "why — required" : "note"} className={FIELD} />
                        <button
                          type="submit"
                          className={`mt-2 font-semibold rounded px-4 py-2 text-sm w-full ${
                            decision === "approve" ? "bg-brand text-white" : "border border-line"
                          }`}
                        >
                          {decision === "approve" ? "Approve" : "Reject"}
                        </button>
                      </form>
                    ))}
                  </div>
                )
              ) : null}

              {/* quotations */}
              <div className="bg-white border border-line rounded p-3">
                <p className="text-sm font-semibold mb-1">
                  Quotations — {quotes.length} of {EXPECTED_QUOTATIONS}
                </p>
                <p className="text-xs text-muted mb-3">
                  Three is the rule most facilities work to, and below the tender threshold it is the law for a
                  public entity. Recorded, not enforced — the threshold that applies here is the facility's to know.
                </p>
                {quotes.length > 0 ? (
                  <table className="w-full text-sm mb-3">
                    <thead>
                      <tr className="text-xs text-muted text-left">
                        <th className="py-1 font-medium">Supplier</th>
                        <th className="py-1 font-medium text-right">Total</th>
                        <th className="py-1 font-medium text-right">Lead</th>
                        <th className="py-1 font-medium">Chosen because</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.map((q, index) => (
                        <tr key={q.id} className={`border-t border-line ${q.selected ? "bg-good-soft" : ""}`}>
                          <td className="py-1.5">
                            {q.supplier_name}
                            {index === 0 ? <span className="text-[10px] text-muted ml-2 uppercase">cheapest</span> : null}
                          </td>
                          <td className="py-1.5 text-right tnum">{formatKes(q.total_cents)}</td>
                          <td className="py-1.5 text-right tnum text-muted">{q.lead_days ?? "—"} d</td>
                          <td className="py-1.5 text-xs">{q.selection_reason || (q.selected ? "chosen" : "")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {acting && openReq.status !== "rejected" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <form action={quotationAction} className="flex flex-wrap gap-2 items-end">
                      <input type="hidden" name="requisitionId" value={openReq.id} />
                      <label className="flex-1 min-w-32"><span className={LABEL}>Supplier</span>
                        <select name="supplierCode" className={FIELD}>
                          {listSuppliers().map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                        </select>
                      </label>
                      <label className="w-28"><span className={LABEL}>Total (KES)</span><input name="total" inputMode="decimal" className={FIELD} /></label>
                      <label className="w-20"><span className={LABEL}>Lead (d)</span><input name="leadDays" inputMode="numeric" className={FIELD} /></label>
                      <button type="submit" className="border border-line font-semibold rounded px-3 py-2 text-sm">Record</button>
                    </form>

                    {quotes.length > 0 ? (
                      <form action={selectAction} className="flex flex-wrap gap-2 items-end">
                        <input type="hidden" name="requisitionId" value={openReq.id} />
                        <label className="w-36"><span className={LABEL}>Choose</span>
                          <select name="supplierCode" className={FIELD}>
                            {quotes.map((q) => <option key={q.id} value={q.supplier_code}>{q.supplier_name}</option>)}
                          </select>
                        </label>
                        <label className="flex-1 min-w-40"><span className={LABEL}>Why this one</span><input name="reason" className={FIELD} /></label>
                        <button type="submit" className="bg-brand text-white font-semibold rounded px-3 py-2 text-sm">Select</button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Section>
          ) : null}

          {acting ? (
            <Section title="Raise a requisition" note="What the store had when you asked is recorded with it, so an approver can see whether it was justified.">
              <form action={requisitionAction} className="bg-white border border-line rounded p-3">
                <div className="grid gap-3 sm:grid-cols-2 mb-3">
                  <label><span className={LABEL}>Store</span>
                    <select name="storeCode" className={FIELD}>
                      {stores.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                    </select>
                  </label>
                  <label><span className={LABEL}>Why</span><input name="reason" placeholder="Down to two weeks of cover" className={FIELD} /></label>
                </div>
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="grid gap-2 sm:grid-cols-[1fr_8rem] mb-2">
                    <label><span className={LABEL}>{n === 1 ? "Product code" : ""}</span><input name={`productCode${n}`} placeholder="PARA-500" className={FIELD} /></label>
                    <label><span className={LABEL}>{n === 1 ? "Quantity" : ""}</span><input name={`quantity${n}`} inputMode="numeric" className={FIELD} /></label>
                  </div>
                ))}
                <button type="submit" className="mt-2 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Raise</button>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ==================================================== orders */}
      {view === "orders" ? (
        <>
          <Section title="Open orders" note="Late first. An order past its date with nothing delivered is a stock-out waiting to happen.">
            {open.length === 0 ? (
              <Empty>No order is outstanding.</Empty>
            ) : (
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 font-medium">Supplier</th>
                    <th className="px-3 py-2 font-medium">Expected</th>
                    <th className="px-3 py-2 font-medium text-right">Value</th>
                    <th className="px-3 py-2 font-medium text-right">Outstanding</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((r) => (
                    <tr key={r.po.id} className={`border-t border-line ${(r.daysLate ?? 0) > 0 ? "bg-clock-soft" : ""} ${r.po.id === openPo?.id ? "bg-brand-soft" : ""}`}>
                      <td className="px-3 py-2 font-mono text-xs">{r.po.reference}</td>
                      <td className="px-3 py-2">{r.supplierName}</td>
                      <td className={`px-3 py-2 tnum ${(r.daysLate ?? 0) > 0 ? "text-clock font-semibold" : "text-muted"}`}>
                        {r.po.expected_on ?? "—"}
                        {(r.daysLate ?? 0) > 0 ? <span className="text-[10px] ml-1">{r.daysLate}d late</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(r.po.total_cents)}</td>
                      <td className="px-3 py-2 text-right tnum">{r.outstandingUnits}</td>
                      <td className="px-3 py-2 text-xs capitalize">{r.po.status.replace("_", " ")}</td>
                      <td className="px-3 py-2 text-right">
                        <a href={`/procurement?view=orders&p=${r.po.id}`} className="text-brand underline underline-offset-2 text-xs">Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {openPo && openPoRow ? (
            <Section
              title={`${openPo.reference} — ${openPoRow.supplierName}`}
              note={`Issued by ${openPo.issuer_name} · ${formatKes(openPo.total_cents)} · ${openPo.status.replace("_", " ")}`}
            >
              <table className="w-full text-sm bg-white border border-line rounded mb-4">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium text-right">Ordered</th>
                    <th className="px-3 py-2 font-medium text-right">Received</th>
                    <th className="px-3 py-2 font-medium text-right">Agreed price</th>
                    <th className="px-3 py-2 font-medium text-right">Line value</th>
                  </tr>
                </thead>
                <tbody>
                  {openPoLines.map((l) => {
                    const received = openPoRow.received.get(l.product_code) ?? 0;
                    const short = received < l.quantity;
                    return (
                      <tr key={l.id} className={`border-t border-line ${short ? "bg-clock-soft" : ""}`}>
                        <td className="px-3 py-2">{l.product_name}</td>
                        <td className="px-3 py-2 text-right tnum">{l.quantity}</td>
                        <td className={`px-3 py-2 text-right tnum ${short ? "text-clock font-bold" : "text-good"}`}>{received}</td>
                        <td className="px-3 py-2 text-right tnum">{formatKes(l.unit_cost_cents)}</td>
                        <td className="px-3 py-2 text-right tnum">{formatKes(l.quantity * l.unit_cost_cents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {openDeliveries.length > 0 ? (
                <div className="bg-white border border-line rounded p-3 mb-4">
                  <p className="text-sm font-semibold mb-2">Deliveries</p>
                  {openDeliveries.map((d) => (
                    <div key={d.id} className="border-t border-line first:border-0 py-2">
                      <div className="flex flex-wrap gap-3 text-sm">
                        <span className="font-mono text-xs">{d.reference}</span>
                        {d.delivery_note ? <span className="text-xs text-muted">DN {d.delivery_note}</span> : null}
                        <span className="text-xs text-muted ml-auto">{d.receiver_name} · {d.received_at.slice(0, 10)}</span>
                      </div>
                      {deliveryLines(d.id).map((l, i) => (
                        <div key={i} className="text-xs text-muted mt-1">
                          {l.product_code}: {l.quantity} · batch {l.batch_number} · expires {l.expires_on}
                          {l.rejected > 0 ? (
                            <span className="text-block font-semibold ml-2">{l.rejected} rejected — {l.reject_reason}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}

              {acting && ["issued", "part_received"].includes(openPo.status) ? (
                <form action={receiveAction} className="bg-white border border-line rounded p-3 mb-4">
                  <input type="hidden" name="poId" value={openPo.id} />
                  <p className="text-sm font-semibold mb-1">Receive a delivery</p>
                  <p className="text-xs text-muted mb-3">
                    Counted at the door. Ordered 1000 and delivered 800 is a fact about the order, not a
                    correction to it — and short-dated stock refused today is a supplier problem, accepted it is ours.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 mb-3">
                    <label><span className={LABEL}>Delivery note</span><input name="deliveryNote" className={FIELD} /></label>
                    <label><span className={LABEL}>Note</span><input name="note" className={FIELD} /></label>
                  </div>
                  {openPoLines.map((l) => (
                    <div key={l.id} className="border-t border-line pt-2 mt-2">
                      <p className="text-xs font-semibold mb-2">{l.product_name} — ordered {l.quantity}</p>
                      <div className="grid gap-2 sm:grid-cols-5">
                        <label><span className={LABEL}>Received</span><input name={`qty_${l.product_code}`} inputMode="numeric" className={FIELD} /></label>
                        <label><span className={LABEL}>Batch</span><input name={`batch_${l.product_code}`} className={FIELD} /></label>
                        <label><span className={LABEL}>Expires</span><input type="date" name={`expiry_${l.product_code}`} className={FIELD} /></label>
                        <label><span className={LABEL}>Rejected</span><input name={`rejected_${l.product_code}`} inputMode="numeric" className={FIELD} /></label>
                        <label><span className={LABEL}>Why rejected</span><input name={`rejectReason_${l.product_code}`} className={FIELD} /></label>
                      </div>
                    </div>
                  ))}
                  <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Receive</button>
                </form>
              ) : null}

              {acting && openPo.status !== "issued" && openPo.status !== "cancelled" ? (
                <form action={invoiceAction} className="bg-white border border-line rounded p-3 mb-4">
                  <input type="hidden" name="poId" value={openPo.id} />
                  <p className="text-sm font-semibold mb-1">Record the supplier's invoice</p>
                  <p className="text-xs text-muted mb-3">Matched against the order and the delivery the moment it is saved.</p>
                  <div className="grid gap-2 sm:grid-cols-3 mb-3">
                    <label><span className={LABEL}>Invoice number</span><input name="invoiceNo" className={FIELD} /></label>
                    <label><span className={LABEL}>Date</span><input type="date" name="invoiceDate" defaultValue={today()} className={FIELD} /></label>
                    <label><span className={LABEL}>eTIMS number</span><input name="etimsNumber" className={FIELD} /></label>
                  </div>
                  {openPoLines.map((l) => (
                    <div key={l.id} className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem] mb-2 items-end">
                      <span className="text-xs">{l.product_name}</span>
                      <label><span className={LABEL}>Qty invoiced</span><input name={`iqty_${l.product_code}`} inputMode="numeric" className={FIELD} /></label>
                      <label><span className={LABEL}>Unit (KES)</span><input name={`iprice_${l.product_code}`} inputMode="decimal" defaultValue={(l.unit_cost_cents / 100).toFixed(2)} className={FIELD} /></label>
                    </div>
                  ))}
                  <button type="submit" className="mt-2 border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">Record and match</button>
                </form>
              ) : null}

              {acting && openPo.status === "issued" ? (
                <form action={cancelOrderAction} className="flex gap-2 items-end">
                  <input type="hidden" name="poId" value={openPo.id} />
                  <label className="flex-1 max-w-md"><span className={LABEL}>Cancel this order</span><input name="reason" placeholder="why" className={FIELD} /></label>
                  <button type="submit" className="border border-line text-muted font-semibold rounded px-3 py-2 text-sm">Cancel</button>
                </form>
              ) : null}
            </Section>
          ) : null}

          {acting ? (
            <Section title="Issue a purchase order" note="Checked against the supplier's PPB licence here, not at the invoice — by the invoice the drugs are already on the shelf.">
              <form action={orderAction} className="bg-white border border-line rounded p-3">
                <div className="grid gap-3 sm:grid-cols-4 mb-3">
                  <label><span className={LABEL}>Supplier</span>
                    <select name="supplierCode" className={FIELD}>
                      {listSuppliers().map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                    </select>
                  </label>
                  <label><span className={LABEL}>Store</span>
                    <select name="storeCode" className={FIELD}>
                      {stores.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                    </select>
                  </label>
                  <label><span className={LABEL}>Expected</span><input type="date" name="expectedOn" className={FIELD} /></label>
                  <label><span className={LABEL}>Against requisition</span>
                    <select name="requisitionId" className={FIELD} defaultValue="">
                      <option value="">None</option>
                      {requisitions.filter((r) => r.status === "approved").map((r) => (
                        <option key={r.id} value={r.id}>{r.reason}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem] mb-2">
                    <label><span className={LABEL}>{n === 1 ? "Product code" : ""}</span><input name={`productCode${n}`} placeholder="PARA-500" className={FIELD} /></label>
                    <label><span className={LABEL}>{n === 1 ? "Quantity" : ""}</span><input name={`quantity${n}`} inputMode="numeric" className={FIELD} /></label>
                    <label><span className={LABEL}>{n === 1 ? "Unit (KES)" : ""}</span><input name={`unitCost${n}`} inputMode="decimal" className={FIELD} /></label>
                  </div>
                ))}
                <button type="submit" className="mt-2 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Issue</button>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* =================================================== invoices */}
      {view === "invoices" ? (
        <Section
          title="The three-way match"
          note="Order, delivery, invoice — worked out line by line rather than trusted from a total. The payable figure is what arrived, at the price that was agreed."
        >
          {invoices.length === 0 ? (
            <Empty>No invoice is waiting.</Empty>
          ) : (
            <div className="space-y-3">
              {invoices.map((i) => (
                <div
                  key={i.id}
                  className={`bg-white border rounded p-3 ${i.status === "queried" ? "border-block" : "border-line"}`}
                >
                  <div className="flex flex-wrap items-baseline gap-3 mb-2">
                    <span className="font-mono text-sm font-semibold">{i.invoice_no}</span>
                    <span className="text-sm">{i.supplier_name}</span>
                    <span className="font-mono text-xs text-muted">{i.reference}</span>
                    {!i.etims_number ? (
                      <span className="text-[10px] font-bold uppercase text-clock tracking-wide">no eTIMS number</span>
                    ) : null}
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-1 ml-auto ${
                        i.status === "queried" ? "bg-block text-white"
                        : i.status === "approved" ? "bg-good-soft text-good"
                        : "bg-brand-soft text-brand-dark"
                      }`}
                    >
                      {i.status}
                    </span>
                  </div>

                  {i.match ? (
                    <>
                      <table className="w-full text-sm mb-2">
                        <thead>
                          <tr className="text-xs text-muted text-left">
                            <th className="px-2 py-1 font-medium">Product</th>
                            <th className="px-2 py-1 font-medium text-right">Ordered</th>
                            <th className="px-2 py-1 font-medium text-right">Received</th>
                            <th className="px-2 py-1 font-medium text-right">Invoiced</th>
                            <th className="px-2 py-1 font-medium text-right">Agreed</th>
                            <th className="px-2 py-1 font-medium text-right">Charged</th>
                            <th className="px-2 py-1 font-medium">Problem</th>
                          </tr>
                        </thead>
                        <tbody>
                          {i.match.lines.map((l) => (
                            <tr key={l.productCode} className={`border-t border-line ${l.notes.length ? "bg-block-soft" : ""}`}>
                              <td className="px-2 py-1.5">{l.productName}</td>
                              <td className="px-2 py-1.5 text-right tnum text-muted">{l.orderedQuantity}</td>
                              <td className="px-2 py-1.5 text-right tnum">{l.receivedQuantity}</td>
                              <td className={`py-1.5 text-right tnum ${l.overInvoiced ? "text-block font-bold" : ""}`}>{l.invoicedQuantity}</td>
                              <td className="px-2 py-1.5 text-right tnum text-muted">{formatKes(l.orderedUnitCents)}</td>
                              <td className={`py-1.5 text-right tnum ${l.priceVariance ? "text-block font-bold" : ""}`}>{formatKes(l.invoicedUnitCents)}</td>
                              <td className="px-2 py-1.5 text-xs text-block">{l.notes.join("; ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div className="flex flex-wrap gap-6 text-sm border-t border-line pt-2">
                        <span>Invoiced <strong className="tnum">{formatKes(i.match.invoicedCents)}</strong></span>
                        <span>Payable <strong className="tnum text-good">{formatKes(i.match.payableCents)}</strong></span>
                        {i.match.varianceCents !== 0 ? (
                          <span className="text-block font-semibold">
                            Difference <strong className="tnum">{formatKes(Math.abs(i.match.varianceCents))}</strong>
                            {i.match.varianceCents > 0 ? " overcharged" : ""}
                          </span>
                        ) : (
                          <span className="text-good font-semibold">Matches</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <form action={matchAction} className="mt-2">
                      <input type="hidden" name="invoiceId" value={i.id} />
                      <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
                        Run the match
                      </button>
                    </form>
                  )}

                  {acting && (i.status === "matched" || i.status === "queried") ? (
                    <form action={approveInvoiceAction} className="flex gap-2 items-end mt-3 pt-3 border-t border-line">
                      <input type="hidden" name="invoiceId" value={i.id} />
                      {i.status === "queried" ? (
                        <label className="flex-1"><span className={LABEL}>Approving a queried invoice must say why</span>
                          <input name="overrideReason" className={FIELD} />
                        </label>
                      ) : null}
                      <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                        Approve for payment
                      </button>
                    </form>
                  ) : null}

                  {acting && i.status === "approved" ? (
                    <form action={payAction} className="flex gap-2 items-end mt-3 pt-3 border-t border-line">
                      <input type="hidden" name="invoiceId" value={i.id} />
                      <label className="flex-1 max-w-xs"><span className={LABEL}>Payment reference</span><input name="paymentRef" className={FIELD} /></label>
                      <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">Pay</button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {/* ================================================== suppliers */}
      {view === "suppliers" ? (
        <>
          <Section title="Suppliers" note="A supplier without a current PPB licence cannot supply medicines, whatever they are selling them for.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Supplier</th>
                    <th className="px-3 py-2 font-medium">KRA PIN</th>
                    <th className="px-3 py-2 font-medium">PPB licence</th>
                    <th className="px-3 py-2 font-medium">AGPO</th>
                    <th className="px-3 py-2 font-medium">Can supply medicines</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => {
                    const licence = canSupplyMedicines(s.code);
                    return (
                      <tr key={s.code} className={`border-t border-line ${s.blocked ? "bg-block-soft opacity-70" : ""}`}>
                        <td className="px-3 py-2">
                          {s.name} <span className="font-mono text-xs text-muted ml-1">{s.code}</span>
                          {s.blocked ? <span className="text-[10px] font-bold uppercase text-block ml-2">blocked</span> : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{s.kra_pin ?? <span className="text-block">missing</span>}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {s.ppb_licence ?? "—"}
                          {s.ppb_expires_on ? <span className="text-muted ml-1">to {s.ppb_expires_on}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-xs capitalize">
                          {s.agpo_category && s.agpo_category !== "none" ? (
                            <span className="text-good font-semibold">{s.agpo_category}</span>
                          ) : "—"}
                        </td>
                        <td className={`px-3 py-2 text-xs ${licence.ok ? "text-good font-semibold" : "text-block font-semibold"}`}>
                          {licence.ok ? "Yes" : licence.why}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {configuring && !s.blocked ? (
                            <form action={blockAction} className="flex gap-1 justify-end">
                              <input type="hidden" name="code" value={s.code} />
                              <input name="reason" placeholder="why" className="border border-line rounded px-2 py-1 text-xs w-32" />
                              <button type="submit" className="border border-block text-block font-semibold rounded px-2 py-1 text-xs">Block</button>
                            </form>
                          ) : s.blocked ? (
                            <span className="text-xs text-muted">{s.blocked_reason}</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {configuring ? (
            <Section title="Add or update a supplier">
              <form action={supplierAction} className="bg-white border border-line rounded p-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <label><span className={LABEL}>Code</span><input name="code" className={FIELD} /></label>
                  <label className="sm:col-span-2"><span className={LABEL}>Name</span><input name="name" className={FIELD} /></label>
                  <label><span className={LABEL}>KRA PIN</span><input name="kraPin" className={FIELD} /></label>
                  <label><span className={LABEL}>PPB licence</span><input name="ppbLicence" className={FIELD} /></label>
                  <label><span className={LABEL}>Expires</span><input type="date" name="ppbExpiresOn" className={FIELD} /></label>
                  <label><span className={LABEL}>AGPO category</span>
                    <select name="agpoCategory" className={FIELD}>
                      <option value="none">None</option>
                      <option value="youth">Youth</option>
                      <option value="women">Women</option>
                      <option value="pwd">Persons with disability</option>
                    </select>
                  </label>
                  <label><span className={LABEL}>AGPO certificate</span><input name="agpoCertificate" className={FIELD} /></label>
                </div>
                <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Save</button>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}

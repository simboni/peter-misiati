import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { check, explain } from "@/lib/access.ts";
import { worklist, dispensesFor, checkDispense } from "@/lib/pharmacy.ts";
import { listStores, onHand, pickable, expiryReport } from "@/lib/inventory.ts";
import { listPayers } from "@/lib/payers.ts";
import { Shell, Stat, Section, Empty, Banner } from "@/app/_components/shell.tsx";
import { dispenseAction } from "./actions.ts";

/**
 * The pharmacy counter.
 *
 * Built around the question a pharmacist actually asks first, which is not
 * "what was prescribed" but "can I fill it": every line carries the stock
 * position and the batch that would go out, before anything is committed. A
 * pharmacist who finds out by trying is a pharmacist with a queue.
 */
export default async function PharmacyPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const stores = listStores(user.facilityId).filter((s) => s.dispensing);
  const store = stores[0];
  if (!store) {
    return (
      <Shell user={user} current="/pharmacy" title="Pharmacy">
        <Banner tone="block">
          No dispensing point is configured. An administrator must define a pharmacy store before
          medicine can be handed over.
        </Banner>
      </Shell>
    );
  }

  const items = worklist(store.code);
  const payers = listPayers();
  const expiring = expiryReport(store.code, 90).slice(0, 5);
  const canDispense = check(user.userId, "dispense.perform");

  return (
    <Shell
      user={user}
      current="/pharmacy"
      title="Pharmacy counter"
      subtitle={`${store.name} — dispensing point`}
      actions={
        <Link href="/stock" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
          Stock
        </Link>
      }
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Waiting" value={items.length} note="prescriptions outstanding" />
        <Stat
          label="Cannot fill today"
          value={items.filter((i) => i.short).length}
          tone={items.some((i) => i.short) ? "clock" : "good"}
          note="short of stock"
        />
        <Stat
          label="Controlled"
          value={items.filter((i) => i.controlled).length}
          note="need the register"
        />
        <Stat
          label="Expiring in 90 days"
          value={expiring.length}
          tone={expiring.length > 0 ? "clock" : "good"}
          note="batches"
          href="/stock"
        />
      </div>

      {!canDispense.allowed ? (
        <div className="mt-5">
          <Banner tone="block">{explain(canDispense)}</Banner>
        </div>
      ) : null}

      <Section title="Waiting at the counter" note="Oldest first. Stock is checked as the list is drawn.">
        {items.length === 0 ? (
          <Empty>Nothing is waiting. Prescriptions appear here as clinicians write them.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const rx = item.prescription;
              const verdict = checkDispense({
                prescriptionId: rx.id,
                storeCode: store.code,
                dispenserId: user.userId,
              });
              const already = dispensesFor(rx.id);
              const batches = pickable(store.code, rx.product_code);

              return (
                <li
                  key={rx.id}
                  className={`bg-white border rounded px-4 py-3 ${
                    item.controlled ? "border-brand/40" : "border-line"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      href={`/patients/${encodeURIComponent(rx.patient_mrn)}`}
                      className="font-semibold underline underline-offset-2"
                    >
                      {item.patientName}
                    </Link>
                    <span className="font-mono text-xs text-muted tnum">{rx.patient_mrn}</span>
                    {item.controlled ? (
                      <span className="text-[11px] font-bold uppercase tracking-wide bg-brand-soft text-brand-dark rounded px-1.5 py-0.5">
                        Controlled
                      </span>
                    ) : null}
                    <span className="text-xs text-muted ml-auto tnum">
                      {rx.prescriber_name} · {rx.created_at.slice(0, 16).replace("T", " ")}
                    </span>
                  </div>

                  <p className="mt-1.5 text-sm">
                    <span className="font-medium">{rx.product_name}</span>
                    <span className="text-muted">
                      {" "}
                      — {rx.dose} {rx.frequency}
                      {rx.duration_days ? ` for ${rx.duration_days} days` : ""}
                    </span>
                  </p>
                  {rx.instructions ? <p className="text-xs text-muted mt-0.5">{rx.instructions}</p> : null}
                  {rx.override_reason ? (
                    <p className="text-xs text-block mt-1">
                      Prescribed over a warning: {rx.override_reason}
                    </p>
                  ) : null}

                  <p className="text-xs mt-1.5 tnum">
                    <span className="text-muted">Outstanding </span>
                    <span className="font-semibold">{item.outstanding}</span>
                    <span className="text-muted"> of {rx.quantity}</span>
                    {already.length > 0 ? (
                      <span className="text-muted"> · {item.dispensed} already given</span>
                    ) : null}
                    <span className="text-muted"> · on hand </span>
                    <span className={`font-semibold ${item.short ? "text-clock" : "text-good"}`}>
                      {item.onHand}
                    </span>
                    {batches[0] ? (
                      <span className="text-muted">
                        {" "}
                        · next batch {batches[0].batch_number}, expires {batches[0].expires_on}
                      </span>
                    ) : null}
                  </p>

                  {verdict.blockers.length > 0 ? (
                    <p className="mt-2 text-xs text-block font-medium">{verdict.blockers.join(" ")}</p>
                  ) : null}
                  {verdict.warnings.length > 0 ? (
                    <p className="mt-1 text-xs text-clock">{verdict.warnings.join(" ")}</p>
                  ) : null}

                  {verdict.canDispense ? (
                    <form action={dispenseAction} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="prescriptionId" value={rx.id} />
                      <input type="hidden" name="storeCode" value={store.code} />
                      <label className="text-xs text-muted">
                        Quantity
                        <input
                          name="quantity"
                          type="number"
                          min={1}
                          max={verdict.available}
                          defaultValue={verdict.available}
                          className="block w-24 border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
                        />
                      </label>
                      <label className="text-xs text-muted">
                        Bill to
                        <select
                          name="payerCode"
                          defaultValue="CASH"
                          className="block border border-line rounded px-2 py-1.5 text-sm bg-white"
                        >
                          {payers.map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-muted flex-1 min-w-[12rem]">
                        Counselling given
                        <input
                          name="counselling"
                          placeholder="Take with food. Complete the course."
                          className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white"
                        />
                      </label>
                      <button
                        type="submit"
                        className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm"
                      >
                        Dispense {verdict.available}
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Expiring soonest" note="What turns into a write-off if it is not used or moved.">
        {expiring.length === 0 ? (
          <Empty>Nothing on the shelf expires within ninety days.</Empty>
        ) : (
          <table className="w-full text-sm bg-white border border-line rounded">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Batch</th>
                <th className="px-3 py-2 font-medium text-right">Quantity</th>
                <th className="px-3 py-2 font-medium text-right">Expires</th>
              </tr>
            </thead>
            <tbody>
              {expiring.map((b) => (
                <tr key={b.id} className="border-t border-line">
                  <td className="px-3 py-2">{b.product_name}</td>
                  <td className="px-3 py-2 font-mono text-xs tnum">{b.batch_number}</td>
                  <td className="px-3 py-2 text-right tnum">{b.quantity}</td>
                  <td className="px-3 py-2 text-right tnum text-clock">{b.expires_on}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </Shell>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { check, explain, can } from "@/lib/access.ts";
import {
  outstandingInvoices, debtorAgeing, takings, paymentsFor, paidCents,
  formatKes, getInvoice, chargesFor,
} from "@/lib/billing.ts";
import { resolvePatient } from "@/lib/patients.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Banner } from "@/app/_components/shell.tsx";
import { takePaymentAction, refundAction } from "./actions.ts";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "insurance", label: "Insurance" },
  { value: "waiver", label: "Waiver" },
] as const;

/**
 * The till.
 *
 * What is owed, oldest first, and the form to take money against it. Split by
 * who owes: a cashier can ask the person standing in front of them, and nobody
 * can ask SHA at the counter — so mixing the two produces a worklist where most
 * lines are not actionable, which is a worklist nobody works.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ invoice?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const { invoice: selected, error } = await searchParams;
  const decision = check(user.userId, "payment.receive");

  const outstanding = outstandingInvoices(user.facilityId);
  const patientOwes = outstanding.filter((o) => !o.payerOwes);
  const payerOwes = outstanding.filter((o) => o.payerOwes);
  const ageing = debtorAgeing(user.facilityId);
  const today_takings = takings(user.facilityId);
  const netToday = today_takings.reduce((sum, t) => sum + t.netCents, 0);
  const canRefund = can(user.userId, "payment.refund");

  // Looked up directly rather than taken from the outstanding list, because an
  // invoice that has just been settled leaves that list — and the cashier still
  // needs to see it, to read the M-Pesa code back to the patient and to refund
  // it if they took the money twice.
  const openInvoice = selected ? getInvoice(selected.toUpperCase()) : undefined;
  const open = openInvoice
    ? {
        invoice: openInvoice,
        patientName: (() => {
          const p = resolvePatient(openInvoice.patient_mrn);
          return p ? `${p.given_name} ${p.family_name}` : openInvoice.patient_mrn;
        })(),
        paidCents: paidCents(openInvoice.id),
        balanceCents: openInvoice.total_cents - paidCents(openInvoice.id),
      }
    : undefined;

  return (
    <Shell
      user={user}
      current="/payments"
      error={error}
      title="Payments"
      subtitle="What is owed, and taking it."
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Taken today" value={formatKes(netToday)} tone={netToday > 0 ? "good" : "muted"} note={today()} />
        <Stat
          label="Patients owe"
          value={formatKes(patientOwes.reduce((s, o) => s + o.balanceCents, 0))}
          tone={patientOwes.length > 0 ? "clock" : "good"}
          note={`${patientOwes.length} invoice${patientOwes.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Payers owe"
          value={formatKes(payerOwes.reduce((s, o) => s + o.balanceCents, 0))}
          tone="muted"
          note={`${payerOwes.length} awaiting settlement`}
          href="/claims"
        />
        <Stat
          label="Over 90 days"
          value={formatKes(
            ageing.patient.find((b) => b.bucket === "90+")!.cents +
              ageing.payer.find((b) => b.bucket === "90+")!.cents,
          )}
          tone={
            ageing.patient.find((b) => b.bucket === "90+")!.cents +
              ageing.payer.find((b) => b.bucket === "90+")!.cents >
            0
              ? "block"
              : "good"
          }
          note="unlikely to arrive"
        />
      </div>

      {!decision.allowed ? (
        <div className="mt-5">
          <Banner tone="block">{explain(decision)}</Banner>
        </div>
      ) : null}

      {/* ---- the one invoice being settled ---- */}
      {open ? (
        <Section title={`${open.patientName} — ${open.invoice.id}`} note={`Issued ${open.invoice.issued_at.slice(0, 10)}`}>
          <div className="bg-white border border-line rounded px-4 py-3">
            <table className="w-full text-sm">
              <tbody>
                {chargesFor(open.invoice.encounter_id).map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-b-0">
                    <td className="py-1.5">{c.description}</td>
                    <td className="py-1.5 text-muted tnum text-right w-16">×{c.quantity}</td>
                    <td className="py-1.5 tnum text-right w-32">{formatKes(c.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-2 pt-2 border-t border-line flex flex-wrap gap-x-6 text-sm tnum">
              <span>
                <span className="text-muted">Invoice </span>
                <span className="font-semibold">{formatKes(open.invoice.total_cents)}</span>
              </span>
              <span>
                <span className="text-muted">Received </span>
                <span className="font-semibold text-good">{formatKes(open.paidCents)}</span>
              </span>
              <span className="ml-auto">
                <span className="text-muted">Balance </span>
                <span className="font-bold text-lg">{formatKes(open.balanceCents)}</span>
              </span>
            </div>

            {open.invoice.etims_number ? (
              <p className="text-xs text-muted mt-2 tnum">
                KRA {open.invoice.etims_number} · the provisional number on the patient&apos;s slip is{" "}
                {open.invoice.id}
              </p>
            ) : (
              <p className="text-xs text-clock mt-2">
                Not yet transmitted to KRA. The patient&apos;s slip carries the provisional number{" "}
                {open.invoice.id}; the canonical one is assigned on transmission and both are kept.
              </p>
            )}
          </div>

          {decision.allowed && open.balanceCents > 0 ? (
            <form action={takePaymentAction} className="mt-3 bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="invoiceId" value={open.invoice.id} />
              <label className="text-xs text-muted">
                Method
                <select name="method" className="block border border-line rounded px-2 py-1.5 text-sm bg-white">
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted">
                Amount (KES)
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  defaultValue={(open.balanceCents / 100).toFixed(2)}
                  className="block w-32 border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
                />
              </label>
              <label className="text-xs text-muted">
                Phone (M-Pesa)
                <input
                  name="phone"
                  placeholder="254712345678"
                  defaultValue={resolvePatient(open.invoice.patient_mrn)?.phone ?? ""}
                  className="block w-40 border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
                />
              </label>
              <label className="text-xs text-muted flex-1 min-w-[10rem]">
                Reference
                <input
                  name="reference"
                  placeholder="Cheque number, card slip — M-Pesa fills itself in"
                  className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white"
                />
              </label>
              <button type="submit" className="bg-good text-white font-semibold rounded px-4 py-2 text-sm">
                Take {formatKes(open.balanceCents)}
              </button>
            </form>
          ) : null}

          {open.balanceCents === 0 ? (
            <div className="mt-3">
              <Banner tone="good">
                Settled in full. The reference below is what the patient has on their own receipt.
              </Banner>
            </div>
          ) : null}

          {/* What has already been received against it, refunds included. */}
          {paymentsFor(open.invoice.id).length > 0 ? (
            <table className="w-full text-sm bg-white border border-line rounded mt-3">
              <tbody>
                {paymentsFor(open.invoice.id).map((p) => (
                  <tr key={p.id} className="border-t border-line first:border-t-0">
                    <td className="px-3 py-1.5 tnum text-muted w-36">
                      {p.received_at.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-1.5">{p.method}</td>
                    <td className="px-3 py-1.5 font-mono text-xs tnum">{p.reference}</td>
                    <td
                      className={`px-3 py-1.5 tnum text-right font-semibold ${
                        p.amount_cents < 0 ? "text-block" : "text-good"
                      }`}
                    >
                      {formatKes(p.amount_cents)}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted">
                      {p.refund_of ? `refund — ${p.reason}` : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {canRefund && p.amount_cents > 0 && !p.refund_of ? (
                        <form action={refundAction} className="flex gap-1 justify-end">
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input type="hidden" name="invoiceId" value={open.invoice.id} />
                          <input
                            name="amount"
                            placeholder="all"
                            className="w-16 border border-line rounded px-1.5 py-1 text-xs tnum bg-white"
                          />
                          <input
                            name="reason"
                            required
                            placeholder="Refund — why?"
                            className="w-36 border border-line rounded px-2 py-1 text-xs bg-white"
                          />
                          <button type="submit" className="border border-block text-block font-semibold rounded px-2 py-1 text-xs">
                            Refund
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {canRefund ? (
            <p className="text-xs text-muted mt-2 leading-relaxed">
              A refund is posted as a negative payment against this invoice, never by removing the original —
              the receipt the patient is holding still has to correspond to a row.
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section title="Patients owe" note="The person is at the desk. This is the list a cashier works.">
        {patientOwes.length === 0 ? (
          <Empty>Nothing outstanding from patients.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {patientOwes.map((o) => (
              <li
                key={o.invoice.id}
                className={`border rounded px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${
                  o.ageDays > 30 ? "bg-clock-soft border-clock/25" : "bg-white border-line"
                }`}
              >
                <Link
                  href={`/patients/${encodeURIComponent(o.invoice.patient_mrn)}`}
                  className="font-medium underline underline-offset-2"
                >
                  {o.patientName}
                </Link>
                <span className="font-mono text-xs text-muted tnum">{o.invoice.id}</span>
                <span className="text-xs text-muted tnum">
                  {o.ageDays === 0 ? "today" : `${o.ageDays} day${o.ageDays === 1 ? "" : "s"} old`}
                </span>
                {o.paidCents > 0 ? (
                  <span className="text-xs text-good tnum">{formatKes(o.paidCents)} part-paid</span>
                ) : null}
                <span className="ml-auto font-semibold tnum">{formatKes(o.balanceCents)}</span>
                <a
                  href={`/payments?invoice=${o.invoice.id}`}
                  className="bg-brand text-white font-semibold rounded px-3 py-1.5 text-xs"
                >
                  Take payment
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {payerOwes.length > 0 ? (
        <Section
          title="Payers owe"
          note="Nobody can chase these at the counter. They are settled through the claim."
        >
          <ul className="flex flex-col gap-2">
            {payerOwes.map((o) => (
              <li key={o.invoice.id} className="bg-white border border-line rounded px-4 py-2.5 flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{o.patientName}</span>
                <span className="font-mono text-xs text-muted tnum">{o.invoice.id}</span>
                <span className="text-xs text-muted">{o.invoice.payer_code}</span>
                <span className="text-xs text-muted tnum">{o.ageDays} days</span>
                <span className="ml-auto font-semibold tnum">{formatKes(o.balanceCents)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Today's till" note="What a cashier balances the drawer against at close.">
        {today_takings.length === 0 ? (
          <Empty>Nothing has been taken today.</Empty>
        ) : (
          <table className="w-full text-sm bg-white border border-line rounded">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium text-right">Received</th>
                <th className="px-3 py-2 font-medium text-right">Refunded</th>
                <th className="px-3 py-2 font-medium text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {today_takings.map((t) => (
                <tr key={t.method} className="border-t border-line">
                  <td className="px-3 py-2">{t.method}</td>
                  <td className="px-3 py-2 text-right tnum text-good">{formatKes(t.received)}</td>
                  <td className={`px-3 py-2 text-right tnum ${t.refunded > 0 ? "text-block" : "text-muted"}`}>
                    {t.refunded > 0 ? formatKes(t.refunded) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tnum font-semibold">{formatKes(t.netCents)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line">
                <td className="px-3 py-2 font-semibold">Total</td>
                <td colSpan={2}></td>
                <td className="px-3 py-2 text-right tnum font-bold">{formatKes(netToday)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Debtor ageing" note="Whether the money is actually coming.">
        <div className="grid gap-3 sm:grid-cols-2">
          {([["Patients", ageing.patient], ["Payers", ageing.payer]] as const).map(([who, buckets]) => (
            <table key={who} className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">{who}</th>
                  <th className="px-3 py-2 font-medium text-right">Invoices</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.bucket} className="border-t border-line">
                    <td className={`px-3 py-2 tnum ${b.bucket === "90+" && b.cents > 0 ? "text-block font-semibold" : ""}`}>
                      {b.bucket} days
                    </td>
                    <td className="px-3 py-2 text-right tnum text-muted">{b.invoices || "—"}</td>
                    <td className={`px-3 py-2 text-right tnum ${b.cents > 0 ? "font-semibold" : "text-muted"}`}>
                      {b.cents > 0 ? formatKes(b.cents) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </Section>
    </Shell>
  );
}

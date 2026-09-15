import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  listRemittances, getRemittance, linesFor, reconciliation, rejectionTaxonomy, unsettledClaims,
} from "@/lib/remittance.ts";
import { listPayers } from "@/lib/payers.ts";
import { formatKes } from "@/lib/billing.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Banner, Views } from "@/app/_components/shell.tsx";
import { importAction, reconcileAction, matchAction, disputeAction } from "./actions.ts";

/**
 * Remittance — what was asked for against what arrived.
 *
 * Until this screen, the system could say "we submitted a hundred claims". It
 * could not say "we were paid for eighty-seven, and here is why not the other
 * thirteen". Every figure here is by VALUE rather than by count, because ninety
 * claims paid out of a hundred sounds excellent and can still be a disaster if
 * the ten that failed were the expensive ones.
 */
export default async function RemittancePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; advice?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "claim.prepare") && !can(user.userId, "report.read")) redirect("/");

  const { view = "advices", advice: selected, error } = await searchParams;
  const advices = listRemittances(user.facilityId);
  const money = reconciliation(user.facilityId);
  const taxonomy = rejectionTaxonomy(user.facilityId);
  const stale = unsettledClaims(user.facilityId, 30);
  const payers = listPayers().filter((p) => p.kind !== "cash");

  const open = selected ? getRemittance(selected.toUpperCase()) : undefined;
  const lines = open ? linesFor(open.id) : [];

  return (
    <Shell
      user={user}
      current={view === "advices" ? "/remittance" : `/remittance?view=${view}`}
      error={error}
      title={
        view === "taxonomy" ? "Why money does not arrive" : view === "unsettled" ? "Never paid" : "Remittance"
      }
      subtitle="What was asked for, against what actually arrived."
    >
      <Views
        current={view}
        views={[
          { key: "advices", label: "Payment advices", href: "/remittance" },
          { key: "taxonomy", label: "Why money does not arrive", href: "/remittance?view=taxonomy" },
          { key: "unsettled", label: "Never paid", href: "/remittance?view=unsettled" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Claimed" value={formatKes(money.submittedCents)} note={`${money.claimsSubmitted} claims`} />
        <Stat
          label="Arrived"
          value={formatKes(money.paidCents)}
          tone="good"
          note={`${money.claimsSettled} settled`}
        />
        <Stat
          label="Short"
          value={formatKes(money.shortfallCents)}
          tone={money.shortfallCents > 0 ? "block" : "good"}
          note="claimed and not paid"
        />
        <Stat
          label="Recovery rate"
          value={money.recoveryRatePercent === null ? "—" : `${money.recoveryRatePercent}%`}
          tone={
            money.recoveryRatePercent === null
              ? "muted"
              : money.recoveryRatePercent >= 95
                ? "good"
                : money.recoveryRatePercent >= 85
                  ? "clock"
                  : "block"
          }
          note="of what was settled, by value"
        />
      </div>

      {money.awaitingCents > 0 ? (
        <div className="mt-5">
          <Banner tone="clock">
            {formatKes(money.awaitingCents)} across {money.claimsAwaiting} claim
            {money.claimsAwaiting === 1 ? "" : "s"} has been submitted and no advice has mentioned it yet.
          </Banner>
        </div>
      ) : null}

      {/* ------------------------------------------------ one advice, in detail */}
      {view === "advices" && open ? (
        <Section
          title={`${open.payer_code} advice ${open.reference}`}
          note={`Dated ${open.advice_date} · imported ${open.imported_at.slice(0, 10)} · ${open.status}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">Their reference</th>
                  <th className="px-3 py-2 font-medium">Our claim</th>
                  <th className="px-3 py-2 font-medium text-right">Claimed</th>
                  <th className="px-3 py-2 font-medium text-right">Paid</th>
                  <th className="px-3 py-2 font-medium text-right">Short</th>
                  <th className="px-3 py-2 font-medium">Their reason</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const short = Math.max(l.claimed_cents - l.paid_cents, 0);
                  return (
                    <tr key={l.id} className="border-t border-line align-top">
                      <td className="px-3 py-2 font-mono text-xs tnum">{l.payer_reference || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs tnum">
                        {l.claim_id ? (
                          <>
                            {l.claim_id}
                            <div className="text-[10px] text-muted font-sans">matched by {l.matched_by}</div>
                          </>
                        ) : (
                          <form action={matchAction} className="flex gap-1">
                            <input type="hidden" name="lineId" value={l.id} />
                            <input type="hidden" name="remittanceId" value={open.id} />
                            <input
                              name="claimId"
                              required
                              placeholder="claim id"
                              className="w-28 border border-line rounded px-1.5 py-1 text-xs font-mono bg-white"
                            />
                            <button type="submit" className="border border-line rounded px-2 py-1 text-xs font-semibold">
                              Match
                            </button>
                          </form>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(l.claimed_cents)}</td>
                      <td className="px-3 py-2 text-right tnum text-good">{formatKes(l.paid_cents)}</td>
                      <td className={`px-3 py-2 text-right tnum ${short > 0 ? "text-block font-semibold" : "text-muted"}`}>
                        {short > 0 ? formatKes(short) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {l.reason_code ? <span className="font-mono font-bold">{l.reason_code} </span> : null}
                        {l.reason || <span className="text-muted">—</span>}
                        {l.disputed_at ? (
                          <div className="text-clock mt-0.5">Disputed: {l.dispute_reason}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {short > 0 && !l.disputed_at ? (
                          <form action={disputeAction} className="flex gap-1 justify-end">
                            <input type="hidden" name="lineId" value={l.id} />
                            <input type="hidden" name="remittanceId" value={open.id} />
                            <input
                              name="reason"
                              required
                              placeholder="Dispute — why?"
                              className="w-40 border border-line rounded px-2 py-1 text-xs bg-white"
                            />
                            <button type="submit" className="border border-clock text-clock rounded px-2 py-1 text-xs font-semibold">
                              Dispute
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {open.status === "imported" ? (
              <form action={reconcileAction}>
                <input type="hidden" name="remittanceId" value={open.id} />
                <button type="submit" className="bg-good text-white font-semibold rounded px-4 py-2 text-sm">
                  Post this advice against the claims
                </button>
              </form>
            ) : (
              <span className="text-sm text-good font-medium">
                Posted{open.reconciled_at ? ` ${open.reconciled_at.slice(0, 10)}` : ""}.
              </span>
            )}
            <span className="text-xs text-muted tnum">
              Payer states {formatKes(open.stated_total_cents)} · lines total{" "}
              {formatKes(lines.reduce((s, l) => s + l.paid_cents, 0))}
            </span>
          </div>
        </Section>
      ) : null}

      {/* ----------------------------------------------------- the advice register */}
      {view === "advices" ? (
        <>
          <Section title="Payment advices">
            {advices.length === 0 ? (
              <Empty>No advice has been imported. Paste one below to reconcile it.</Empty>
            ) : (
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Payer</th>
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 font-medium text-right">Lines</th>
                    <th className="px-3 py-2 font-medium text-right">Paid</th>
                    <th className="px-3 py-2 font-medium text-right">Short</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {advices.map((a) => (
                    <tr key={a.id} className="border-t border-line">
                      <td className="px-3 py-2 tnum text-muted">{a.advice_date}</td>
                      <td className="px-3 py-2">{a.payer_code}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link href={`/remittance?advice=${a.id}`} className="text-brand underline underline-offset-2">
                          {a.reference}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tnum text-muted">{a.lines}</td>
                      <td className="px-3 py-2 text-right tnum text-good">{formatKes(a.paid_cents)}</td>
                      <td className={`px-3 py-2 text-right tnum ${a.shortfall_cents > 0 ? "text-block" : "text-muted"}`}>
                        {a.shortfall_cents > 0 ? formatKes(a.shortfall_cents) : "—"}
                      </td>
                      <td
                        className={`px-3 py-2 ${
                          a.status === "reconciled" ? "text-good" : a.status === "disputed" ? "text-clock" : "text-muted"
                        }`}
                      >
                        {a.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title="Import an advice"
            note="Paste the rows from the payer's portal. One claim per row: their reference, amount paid, then optionally what was claimed, a reason code and a reason."
          >
            <form action={importAction} className="bg-white border border-line rounded px-4 py-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted">
                  Payer
                  <select name="payerCode" className="block border border-line rounded px-2 py-1.5 text-sm bg-white">
                    {payers.map((p) => (
                      <option key={p.code} value={p.code}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Their reference
                  <input
                    name="reference"
                    required
                    placeholder="PA-2026-0912"
                    className="block w-44 border border-line rounded px-2 py-1.5 text-sm font-mono bg-white"
                  />
                </label>
                <label className="text-xs text-muted">
                  Advice date
                  <input
                    name="adviceDate"
                    type="date"
                    required
                    defaultValue={today()}
                    className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
                  />
                </label>
                <label className="text-xs text-muted">
                  Total they state (KES)
                  <input
                    name="statedTotal"
                    inputMode="decimal"
                    required
                    className="block w-32 border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
                  />
                </label>
              </div>
              <label className="text-xs text-muted">
                The lines
                <textarea
                  name="lines"
                  required
                  rows={5}
                  placeholder={"SHA-000123, 4800\nSHA-000124, 3200, 5600, E11, Service not covered under the package"}
                  className="block w-full border border-line rounded px-2 py-1.5 text-sm font-mono bg-white mt-0.5"
                />
              </label>
              <div>
                <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                  Import
                </button>
              </div>
            </form>
          </Section>
        </>
      ) : null}

      {/* --------------------------------------------------------- the taxonomy */}
      {view === "taxonomy" ? (
        <Section
          title="Why money does not arrive"
          note="Ranked by what each reason cost, not how often it happened — a rare rejection on a large claim matters more than a common one on a small one."
        >
          {taxonomy.length === 0 ? (
            <Empty>Nothing has been paid short. Once an advice is posted, the reasons collect here.</Empty>
          ) : (
            <>
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">The payer&apos;s reason</th>
                    <th className="px-3 py-2 font-medium text-right">Times</th>
                    <th className="px-3 py-2 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {taxonomy.map((t, i) => (
                    <tr key={`${t.code}-${i}`} className="border-t border-line">
                      <td className="px-3 py-2 font-mono text-xs font-bold">{t.code ?? "—"}</td>
                      <td className="px-3 py-2">{t.reason}</td>
                      <td className="px-3 py-2 text-right tnum text-muted">{t.occurrences}</td>
                      <td className="px-3 py-2 text-right tnum font-semibold text-block">{formatKes(t.costCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted mt-3 leading-relaxed">
                This is the corpus the scrubber was always supposed to be built from. The roadmap asks for
                fifty real rejected claims before writing the rules; this is how a facility accumulates them
                by doing its ordinary work. When a reason near the top is not caught by any of the nine gates,
                that is the next gate.
              </p>
            </>
          )}
        </Section>
      ) : null}

      {/* -------------------------------------------------------- never settled */}
      {view === "unsettled" ? (
        <Section
          title="Submitted, and never paid for"
          note="No payment advice has ever mentioned these. Over thirty days old."
        >
          {stale.length === 0 ? (
            <Empty>Every submitted claim has appeared on an advice.</Empty>
          ) : (
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">Claim</th>
                  <th className="px-3 py-2 font-medium">Payer</th>
                  <th className="px-3 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 font-medium text-right">Value</th>
                  <th className="px-3 py-2 font-medium text-right">Days out</th>
                </tr>
              </thead>
              <tbody>
                {stale.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-xs tnum">{c.id}</td>
                    <td className="px-3 py-2 text-muted">{c.payer_code}</td>
                    <td className="px-3 py-2 font-mono text-xs tnum">
                      <Link href={`/patients/${encodeURIComponent(c.patient_mrn)}`} className="text-brand underline underline-offset-2">
                        {c.patient_mrn}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tnum font-semibold">{formatKes(c.total_cents)}</td>
                    <td className={`px-3 py-2 text-right tnum ${c.days > 60 ? "text-block font-semibold" : "text-clock"}`}>
                      {c.days}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ) : null}
    </Shell>
  );
}

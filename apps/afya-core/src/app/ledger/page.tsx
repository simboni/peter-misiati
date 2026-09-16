import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  ledgerSummary, trialBalance, incomeStatement, balanceSheet, reconcile,
  journalsIn, journalLines, getJournal, chartOfAccounts, listPeriods, accountLedger,
} from "@/lib/accounting.ts";
import { formatKes } from "@/lib/billing.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  postAction, reverseAction, postFromOperationsAction, closePeriodAction, reopenPeriodAction,
} from "./actions.ts";

/**
 * The general ledger.
 *
 * Reconciliation is the first thing on the page, because "does the ledger agree
 * with the till" is the question a ledger exists to answer and the one most
 * systems cannot.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; j?: string; a?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "report.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "position";
  const acting = can(user.userId, "report.read");
  const configuring = can(user.userId, "facility.configure");

  const summary = ledgerSummary(user.facilityId);
  const month = today().slice(0, 7);
  const balance = trialBalance(user.facilityId);
  const income = incomeStatement(user.facilityId, `${month}-01`, today());
  const sheet = balanceSheet(user.facilityId);
  const check = reconcile(user.facilityId);
  const journals = journalsIn(user.facilityId, undefined, undefined, 40);
  const accounts = chartOfAccounts();
  const periods = listPeriods(user.facilityId);

  const openJournal = params.j ? getJournal(params.j) : undefined;
  const openLines = openJournal ? journalLines(openJournal.id) : [];
  const openAccount = params.a ? accounts.find((a) => a.code === params.a) : undefined;
  const accountRows = openAccount ? accountLedger(openAccount.code, user.facilityId, 40) : [];

  const href = (v: string) => (v === "position" ? "/ledger" : `/ledger?view=${v}`);

  return (
    <Shell
      user={user}
      current={href(view)}
      error={params.error}
      title={
        view === "journals" ? "Journals"
        : view === "reports" ? "Income and balance sheet"
        : view === "periods" ? "Periods"
        : "Position & reconciliation"
      }
      subtitle={
        view === "position"
          ? "The ledger and the operational record are the same facts, so they can be compared. When they disagree, this page says so rather than assuming."
          : undefined
      }
      actions={
        acting && summary.unpostedSources > 0 ? (
          <form action={postFromOperationsAction}>
            <button type="submit" className="bg-block text-white font-semibold rounded px-3 py-2 text-sm">
              Post {summary.unpostedSources} outstanding
            </button>
          </form>
        ) : null
      }
    >
      <Views
        current={view}
        views={[
          { key: "position", label: "Position", href: "/ledger" },
          { key: "reports", label: "Reports", href: "/ledger?view=reports" },
          { key: "journals", label: "Journals", href: "/ledger?view=journals" },
          { key: "periods", label: "Periods", href: "/ledger?view=periods" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Trial balance"
          value={summary.trialBalanceDifferenceCents === 0 ? "Balanced" : formatKes(Math.abs(summary.trialBalanceDifferenceCents))}
          tone={summary.trialBalanceDifferenceCents === 0 ? "good" : "block"}
          note={`${summary.journals} journals · period ${summary.openPeriod ?? "none open"}`}
        />
        <Stat
          label="Not yet posted"
          value={summary.unpostedSources}
          tone={summary.unpostedSources > 0 ? "clock" : "good"}
          note={summary.unpostedSources > 0 ? "payments and invoices with no journal" : "the ledger is up to date"}
        />
        <Stat
          label="Cash and bank"
          value={formatKes(summary.cashCents)}
          tone={check.agrees ? "good" : "block"}
          note={check.agrees ? "agrees with the till" : "does NOT agree with the till"}
        />
        <Stat
          label="Surplus this month"
          value={formatKes(summary.surplusCents)}
          tone={summary.surplusCents >= 0 ? "good" : "block"}
          note={`${formatKes(summary.incomeCents)} in, ${formatKes(summary.expenseCents)} out`}
        />
      </div>

      {/* =============================================== position */}
      {view === "position" ? (
        <>
          <Section
            title="Does the ledger agree with the rest of the system?"
            note="Most hospital systems cannot answer this, because the ledger and the operational record come from different people and different sources. Here they are the same facts."
          >
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="px-3 py-2 font-medium text-right">Ledger</th>
                  <th className="px-3 py-2 font-medium text-right">Operations</th>
                  <th className="px-3 py-2 font-medium text-right">Difference</th>
                  <th className="px-3 py-2 font-medium">Compared</th>
                </tr>
              </thead>
              <tbody>
                {check.lines.map((line) => (
                  <tr key={line.what} className={`border-t border-line ${line.agrees ? "" : "bg-block-soft"}`}>
                    <td className="px-3 py-2">{line.what}</td>
                    <td className="px-3 py-2 text-right tnum">{formatKes(line.ledgerCents)}</td>
                    <td className="px-3 py-2 text-right tnum">{formatKes(line.operationalCents)}</td>
                    <td className={`px-3 py-2 text-right tnum font-bold ${line.agrees ? "text-good" : "text-block"}`}>
                      {line.agrees ? "—" : formatKes(line.differenceCents)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{line.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {check.otherCashCents !== 0 ? (
              <p className="text-xs text-muted mt-3 leading-relaxed">
                {formatKes(check.otherCashCents)} of cash moved today for reasons other than a patient payment — a
                float, petty cash, a correction. Shown rather than hidden: it is why the figures above are not
                simply the account balance, and it is not a discrepancy.
              </p>
            ) : null}
            {!check.agrees ? (
              <p className="text-xs text-block font-semibold mt-3">
                A difference here is usually the posting job being behind, not money missing. Run it, then look again.
              </p>
            ) : null}
          </Section>

          <Section title="Trial balance" note="The only thing a trial balance is for is balancing, and this one does.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium text-right">Debit</th>
                    <th className="px-3 py-2 font-medium text-right">Credit</th>
                    <th className="px-3 py-2 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.lines.map((l) => (
                    <tr key={l.code} className="border-t border-line">
                      <td className="px-3 py-2">
                        <a href={`/ledger?a=${l.code}`} className="underline underline-offset-2">
                          <span className="font-mono text-xs mr-2">{l.code}</span>{l.name}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted capitalize">{l.kind}</td>
                      <td className="px-3 py-2 text-right tnum">{l.debitCents ? formatKes(l.debitCents) : "—"}</td>
                      <td className="px-3 py-2 text-right tnum">{l.creditCents ? formatKes(l.creditCents) : "—"}</td>
                      <td className="px-3 py-2 text-right tnum font-semibold">{formatKes(l.balanceCents)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-ink font-bold">
                    <td className="px-3 py-2" colSpan={2}>Total</td>
                    <td className="px-3 py-2 text-right tnum">{formatKes(balance.debitCents)}</td>
                    <td className="px-3 py-2 text-right tnum">{formatKes(balance.creditCents)}</td>
                    <td className={`px-3 py-2 text-right tnum ${balance.differenceCents === 0 ? "text-good" : "text-block"}`}>
                      {balance.differenceCents === 0 ? "balanced" : formatKes(balance.differenceCents)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          {openAccount ? (
            <Section title={`${openAccount.code} — ${openAccount.name}`} note={`${openAccount.kind}, increases on the ${openAccount.normal_side} side`}>
              {accountRows.length === 0 ? (
                <Empty>Nothing has been posted to this account.</Empty>
              ) : (
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Narrative</th>
                      <th className="px-3 py-2 font-medium text-right">Debit</th>
                      <th className="px-3 py-2 font-medium text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountRows.map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="px-3 py-2 tnum text-muted">{r.entry_date}</td>
                        <td className="px-3 py-2">
                          <a href={`/ledger?view=journals&j=${r.journal_id}`} className="underline underline-offset-2">
                            {r.narrative}
                          </a>
                          {r.memo ? <span className="text-xs text-muted ml-2">{r.memo}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-right tnum">{r.debit_cents ? formatKes(r.debit_cents) : "—"}</td>
                        <td className="px-3 py-2 text-right tnum">{r.credit_cents ? formatKes(r.credit_cents) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ================================================ reports */}
      {view === "reports" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={`Income and expenditure — ${month}`} note="Covers the period, not everything ever.">
            <table className="w-full text-sm bg-white border border-line rounded">
              <tbody>
                <tr className="border-b border-line"><td className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted" colSpan={2}>Income</td></tr>
                {income.income.map((l) => (
                  <tr key={l.code} className="border-t border-line">
                    <td className="px-3 py-1.5">{l.name}</td>
                    <td className="px-3 py-1.5 text-right tnum">{formatKes(l.balanceCents)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-semibold">
                  <td className="px-3 py-1.5">Total income</td>
                  <td className="px-3 py-1.5 text-right tnum">{formatKes(income.incomeCents)}</td>
                </tr>
                <tr className="border-b border-line"><td className="px-3 py-2 pt-4 text-xs font-bold uppercase tracking-wide text-muted" colSpan={2}>Expenditure</td></tr>
                {income.expenses.map((l) => (
                  <tr key={l.code} className="border-t border-line">
                    <td className="px-3 py-1.5">{l.name}</td>
                    <td className="px-3 py-1.5 text-right tnum">{formatKes(l.balanceCents)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-semibold">
                  <td className="px-3 py-1.5">Total expenditure</td>
                  <td className="px-3 py-1.5 text-right tnum">{formatKes(income.expenseCents)}</td>
                </tr>
                <tr className="border-t-2 border-ink font-bold">
                  <td className="px-3 py-2">Surplus</td>
                  <td className={`px-3 py-2 text-right tnum ${income.surplusCents >= 0 ? "text-good" : "text-block"}`}>
                    {formatKes(income.surplusCents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section title={`Balance sheet — ${sheet.asOf}`} note="The surplus is shown separately rather than folded into equity, which is more honest.">
            <table className="w-full text-sm bg-white border border-line rounded">
              <tbody>
                {([
                  ["Assets", sheet.assets, sheet.assetCents],
                  ["Liabilities", sheet.liabilities, sheet.liabilityCents],
                  ["Equity", sheet.equity, sheet.equityCents],
                ] as const).map(([title, lines, total]) => (
                  <>
                    <tr key={title} className="border-b border-line">
                      <td className="px-3 py-2 pt-4 text-xs font-bold uppercase tracking-wide text-muted" colSpan={2}>{title}</td>
                    </tr>
                    {lines.map((l) => (
                      <tr key={l.code} className="border-t border-line">
                        <td className="px-3 py-1.5">{l.name}</td>
                        <td className="px-3 py-1.5 text-right tnum">{formatKes(l.balanceCents)}</td>
                      </tr>
                    ))}
                    <tr key={`${title}-total`} className="border-t border-line font-semibold">
                      <td className="px-3 py-1.5">Total {title.toLowerCase()}</td>
                      <td className="px-3 py-1.5 text-right tnum">{formatKes(total)}</td>
                    </tr>
                  </>
                ))}
                <tr className="border-t border-line font-semibold">
                  <td className="px-3 py-1.5">Surplus to date</td>
                  <td className="px-3 py-1.5 text-right tnum">{formatKes(sheet.surplusCents)}</td>
                </tr>
                <tr className="border-t-2 border-ink font-bold">
                  <td className="px-3 py-2">Assets less liabilities, equity and surplus</td>
                  <td className={`px-3 py-2 text-right tnum ${sheet.balancesCents === 0 ? "text-good" : "text-block"}`}>
                    {sheet.balancesCents === 0 ? "balances" : formatKes(sheet.balancesCents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>
        </div>
      ) : null}

      {/* =============================================== journals */}
      {view === "journals" ? (
        <>
          <Section title="Journals" note="Derived from what happened, or posted by hand. Either way, never edited afterwards.">
            {journals.length === 0 ? (
              <Empty>Nothing has been posted.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Narrative</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium text-right">Amount</th>
                      <th className="px-3 py-2 font-medium">By</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {journals.map((j) => (
                      <tr key={j.id} className={`border-t border-line ${j.reverses ? "opacity-70" : ""} ${j.id === openJournal?.id ? "bg-brand-soft" : ""}`}>
                        <td className="px-3 py-2 tnum text-muted">{j.entry_date}</td>
                        <td className="px-3 py-2">{j.narrative}</td>
                        <td className="px-3 py-2 text-xs text-muted capitalize">
                          {j.source_kind.replace("_", " ")}
                          {j.reverses ? <span className="text-clock font-semibold ml-1">reversal</span> : null}
                        </td>
                        <td className="px-3 py-2 text-right tnum">{formatKes(j.total_cents)}</td>
                        <td className="px-3 py-2 text-xs text-muted">{j.poster_name}</td>
                        <td className="px-3 py-2 text-right">
                          <a href={`/ledger?view=journals&j=${j.id}`} className="text-brand underline underline-offset-2 text-xs">Open</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {openJournal ? (
            <Section
              title={openJournal.narrative}
              note={`${openJournal.entry_date} · period ${openJournal.period_code} · ${openJournal.poster_name}${
                openJournal.reverses ? ` · reverses ${openJournal.reverses}` : ""
              }`}
            >
              <table className="w-full text-sm bg-white border border-line rounded mb-4">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 font-medium text-right">Debit</th>
                    <th className="px-3 py-2 font-medium text-right">Credit</th>
                    <th className="px-3 py-2 font-medium">Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {openLines.map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs mr-2">{l.account_code}</span>
                        {accounts.find((a) => a.code === l.account_code)?.name}
                      </td>
                      <td className="px-3 py-2 text-right tnum">{l.debit_cents ? formatKes(l.debit_cents) : ""}</td>
                      <td className="px-3 py-2 text-right tnum">{l.credit_cents ? formatKes(l.credit_cents) : ""}</td>
                      <td className="px-3 py-2 text-xs text-muted">{l.memo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {openJournal.reversal_reason ? (
                <p className="text-sm text-clock font-semibold mb-4">{openJournal.reversal_reason}</p>
              ) : acting && !openJournal.reverses ? (
                <form action={reverseAction} className="flex gap-2 items-end">
                  <input type="hidden" name="journalId" value={openJournal.id} />
                  <label className="flex-1 max-w-lg"><span className={LABEL}>Reverse this journal — it is never edited</span>
                    <input name="reason" placeholder="why" className={FIELD} />
                  </label>
                  <button type="submit" className="border border-line font-semibold rounded px-4 py-2 text-sm">Reverse</button>
                </form>
              ) : null}
            </Section>
          ) : null}

          {acting ? (
            <Section title="Post a journal by hand" note="Refused before anything is written if the two sides do not agree.">
              <form action={postAction} className="bg-white border border-line rounded p-3">
                <div className="grid gap-3 sm:grid-cols-2 mb-3">
                  <label><span className={LABEL}>Date</span><input type="date" name="entryDate" defaultValue={today()} className={FIELD} /></label>
                  <label><span className={LABEL}>Narrative</span><input name="narrative" className={FIELD} /></label>
                </div>
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem_1fr] mb-2">
                    <label><span className={LABEL}>{n === 1 ? "Account" : ""}</span>
                      <select name={`account${n}`} className={FIELD} defaultValue="">
                        <option value=""></option>
                        {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                      </select>
                    </label>
                    <label><span className={LABEL}>{n === 1 ? "Debit (KES)" : ""}</span><input name={`debit${n}`} inputMode="decimal" className={FIELD} /></label>
                    <label><span className={LABEL}>{n === 1 ? "Credit (KES)" : ""}</span><input name={`credit${n}`} inputMode="decimal" className={FIELD} /></label>
                    <label><span className={LABEL}>{n === 1 ? "Memo" : ""}</span><input name={`memo${n}`} className={FIELD} /></label>
                  </div>
                ))}
                <button type="submit" className="mt-2 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Post</button>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ================================================ periods */}
      {view === "periods" ? (
        <Section title="Periods" note="A closed period takes no postings. A late entry goes to the open one, carrying a note about what it is for.">
          {periods.length === 0 ? (
            <Empty>No period has been opened.</Empty>
          ) : (
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">To</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Closed by</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.code} className={`border-t border-line ${p.status === "open" ? "" : "opacity-70"}`}>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{p.code}</td>
                    <td className="px-3 py-2 tnum text-muted">{p.starts_on}</td>
                    <td className="px-3 py-2 tnum text-muted">{p.ends_on}</td>
                    <td className={`px-3 py-2 text-xs font-semibold capitalize ${p.status === "open" ? "text-good" : "text-muted"}`}>
                      {p.status}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{p.closer_name || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {configuring && p.status === "open" ? (
                        <form action={closePeriodAction} className="inline">
                          <input type="hidden" name="code" value={p.code} />
                          <button type="submit" className="border border-line font-semibold rounded px-3 py-1 text-xs">Close</button>
                        </form>
                      ) : configuring ? (
                        <form action={reopenPeriodAction} className="flex gap-1 justify-end">
                          <input type="hidden" name="code" value={p.code} />
                          <input name="reason" placeholder="why reopen" className="border border-line rounded px-2 py-1 text-xs w-36" />
                          <button type="submit" className="border border-line text-muted font-semibold rounded px-2 py-1 text-xs">Reopen</button>
                        </form>
                      ) : null}
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

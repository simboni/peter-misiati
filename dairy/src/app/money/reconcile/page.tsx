import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { today } from "@/lib/domain/dates";
import { kes } from "@/lib/money";
import { importMpesaCsvAction, reconcileMpesa } from "@/server/money";
import { MpesaImportForm } from "@/components/money/entry-forms";
import { Card, Chip, EmptyState, Num, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Reconcile in the evening, while the errors are still fixable.
 *
 * We deliberately do not integrate the Daraja API. Full integration needs
 * business registration, a Paybill or a Till upgraded to bank settlement, B2C
 * approval and a public callback — and a Till settling to a personal M-Pesa
 * number is not even eligible. Records plus this screen deliver most of the
 * value at a fraction of the burden.
 */
export default async function ReconcilePage({
  searchParams,
}: {
  // Next 16: searchParams is always a promise.
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const session = await verifySession();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const recon = await reconcileMpesa(session, date);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <Link href="/money" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> Money
      </Link>
      <PageTitle sub="Match the M-Pesa statement against what was written down.">
        Reconcile M-Pesa
      </PageTitle>

      <form method="get" className="mb-4 flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-sm font-medium">Day</span>
          <input
            type="date"
            name="date"
            defaultValue={date}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
          />
        </label>
        <button type="submit" className="rounded-md border border-line bg-surface px-5 py-3 font-semibold">
          Show
        </button>
      </form>

      <Card className="mb-4">
        <p className="text-base">{recon.summary}</p>
      </Card>

      {recon.unmatchedLines.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 text-lg font-semibold">
            <span aria-hidden className="mr-2 text-danger">
              ⛔
            </span>
            Money moved with nothing written down
          </h2>
          <ul className="space-y-2">
            {recon.unmatchedLines.map((l) => (
              <li key={l.receiptNo} className="rounded-lg border-l-4 border-danger border-y border-r border-line bg-surface p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {l.direction === "IN" ? "Received" : "Paid out"} — {l.details ?? "no detail"}
                  </span>
                  <span className="tabular-nums font-semibold">
                    <Num>{kes(l.amountKes)}</Num>
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-2">{l.advice}</p>
                <p className="mt-1 font-mono text-xs text-ink-3">{l.receiptNo}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recon.unmatchedRecords.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 text-lg font-semibold">
            <span aria-hidden className="mr-2 text-brass">
              ⚠
            </span>
            Written down but not on the statement
          </h2>
          <ul className="space-y-2">
            {recon.unmatchedRecords.map((r) => (
              <li key={r.id} className="rounded-lg border-l-4 border-brass border-y border-r border-line bg-surface p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{r.label}</span>
                  <span className="tabular-nums font-semibold">
                    <Num>{kes(r.amountKes)}</Num>
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-2">{r.advice}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recon.matched.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Matched</h2>
          <ul className="space-y-2">
            {recon.matched.map((m) => (
              <li key={m.receiptNo} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm">{m.recordLabel}</span>
                  <span className="tabular-nums text-sm font-semibold">
                    {m.direction === "IN" ? "+" : "−"}
                    {kes(m.amountKes)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Chip tone={m.matchedOn === "REFERENCE" ? "ok" : "neutral"}>
                    {m.matchedOn === "REFERENCE" ? "matched on code" : "matched on amount and date"}
                  </Chip>
                  <span className="font-mono text-xs text-ink-3">{m.receiptNo}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recon.matched.length === 0 &&
      recon.unmatchedLines.length === 0 &&
      recon.unmatchedRecords.length === 0 ? (
        <EmptyState
          title={`Nothing on file for ${date}`}
          hint="Import the statement below, then come back."
        />
      ) : null}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Import a statement</h2>
        <MpesaImportForm action={importMpesaCsvAction} />
      </Card>
    </main>
  );
}

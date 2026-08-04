/**
 * Day close — the screen the owner opens every evening.
 *
 * This is the shop's main theft control. Everything above the input is
 * arithmetic the system already knows; the only thing a person supplies is the
 * counted cash. The last seven closes sit underneath so a run of small
 * shortages, which is what pilferage actually looks like, becomes obvious
 * without anyone having to keep it in their head.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, requireUser } from "@/lib/auth";
import { run, tx, audit } from "@/lib/db";
import { formatKes, toCents, businessDate, formatDate } from "@/lib/units";
import {
  dayTotals,
  recentCloses,
  closeForDate,
  varianceTone,
  VARIANCE_WARN_CENTS,
  VARIANCE_BAD_CENTS,
} from "@/lib/reports";
import { PageTitle, Card, SectionLabel, Stat, TableWrap, Th, Td, Empty, Chip } from "@/components/ui";
import { CloseForm, type CloseState } from "./close-form";

export const dynamic = "force-dynamic";

async function saveClose(_prev: CloseState, formData: FormData): Promise<CloseState> {
  "use server";

  const user = await requireUser();

  // The date comes from the form, but it is re-derived below from the same
  // business-date rule the totals use, so a stale tab cannot close a past day.
  const date = businessDate();
  const raw = String(formData.get("counted") ?? "").trim();
  const shillings = Number(raw);
  if (raw === "" || !Number.isFinite(shillings) || shillings < 0) {
    return { error: "Enter the cash you counted, in shillings." };
  }

  const counted = toCents(shillings);
  const totals = dayTotals(date);
  const variance = counted - totals.expectedCashCents;
  const note = String(formData.get("note") ?? "").slice(0, 200);

  tx(() => {
    // Re-closing the same day is normal — the owner recounts. Keep one row per
    // business date and overwrite it, but always record who closed it last.
    run(
      `INSERT INTO day_closes (business_date, expected_cash_cents, counted_cash_cents,
                               variance_cents, mpesa_cents, credit_cents, note, closed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (business_date) DO UPDATE SET
         expected_cash_cents = excluded.expected_cash_cents,
         counted_cash_cents  = excluded.counted_cash_cents,
         variance_cents      = excluded.variance_cents,
         mpesa_cents         = excluded.mpesa_cents,
         credit_cents        = excluded.credit_cents,
         note                = excluded.note,
         closed_by           = excluded.closed_by,
         closed_at           = datetime('now')`,
      date,
      totals.expectedCashCents,
      counted,
      variance,
      totals.mpesaCents,
      totals.creditCents,
      note,
      user.id,
    );
    audit(
      user.id,
      "day_close",
      "day_close",
      null,
      `${date}: expected ${totals.expectedCashCents}, counted ${counted}, variance ${variance}`,
    );
  });

  revalidatePath("/day-close");
  return { ok: true, varianceCents: variance };
}

export default async function DayClosePage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const today = businessDate();
  const totals = dayTotals(today);
  const existing = closeForDate(today);
  const history = recentCloses(7);

  return (
    <div>
      <PageTitle
        title="Day close"
        subtitle={`${formatDate(noonOn(today))} · counted in Nairobi time, so evening sales are on today`}
      />

      <div className="grid grid-cols-2 gap-2.5">
        <Stat
          label="Sales today"
          value={formatKes(totals.salesCents)}
          detail={`${totals.saleCount} ${totals.saleCount === 1 ? "sale" : "sales"}`}
        />
        <Stat label="M-Pesa" value={formatKes(totals.mpesaCents)} detail="paid by phone" />
        <Stat label="On credit" value={formatKes(totals.creditCents)} detail="not in the drawer" />
        <Stat
          label="Cash expenses"
          value={formatKes(totals.expenseCashCents)}
          detail="paid out today"
        />
      </div>

      <SectionLabel>Expected in the drawer</SectionLabel>
      <Card>
        <dl className="space-y-1.5 text-sm">
          {totals.floatCents > 0 ? (
            <Line label="Float you started with" value={formatKes(totals.floatCents)} />
          ) : null}
          <Line label="Cash taken" value={formatKes(totals.cashInCents)} />
          <Line label="Less cash expenses" value={`− ${formatKes(totals.expenseCashCents)}`} />
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
            <dt className="text-sm font-bold">Expected cash</dt>
            <dd className="text-2xl font-extrabold tracking-tight tnum">
              {formatKes(totals.expectedCashCents)}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted">
          M-Pesa and credit are excluded — neither is money you can count tonight.
        </p>
      </Card>

      <SectionLabel>Count the cash</SectionLabel>
      <Card>
        {existing ? (
          <p className="mb-3 text-xs text-muted">
            Today was already closed by {existing.closed_by_name ?? "someone"} with a variance of{" "}
            <span className="font-bold tnum">{formatKes(existing.variance_cents)}</span>. Saving
            again replaces it.
          </p>
        ) : null}
        <CloseForm
          date={today}
          expectedCashCents={totals.expectedCashCents}
          warnCents={VARIANCE_WARN_CENTS}
          badCents={VARIANCE_BAD_CENTS}
          defaultCounted={existing ? String(existing.counted_cash_cents / 100) : ""}
          defaultNote={existing?.note ?? ""}
          alreadyClosed={Boolean(existing)}
          action={saveClose}
        />
      </Card>

      <SectionLabel>Last 7 closes</SectionLabel>
      {history.length ? (
        <TableWrap>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th align="right">Expected</Th>
              <Th align="right">Counted</Th>
              <Th align="right">Difference</Th>
              <Th>Closed by</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((c) => {
              const tone = varianceTone(c.variance_cents);
              return (
                <tr key={c.id}>
                  <Td>{formatDate(noonOn(c.business_date))}</Td>
                  <Td align="right">{formatKes(c.expected_cash_cents)}</Td>
                  <Td align="right">{formatKes(c.counted_cash_cents)}</Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={
                          tone === "good"
                            ? "text-good"
                            : tone === "warn"
                              ? "text-warn"
                              : "font-bold text-bad"
                        }
                      >
                        {c.variance_cents > 0 ? "+" : ""}
                        {formatKes(c.variance_cents)}
                      </span>
                      {tone !== "good" ? (
                        <Chip tone={tone}>{c.variance_cents < 0 ? "Short" : "Over"}</Chip>
                      ) : null}
                    </span>
                  </Td>
                  <Td>{c.closed_by_name ?? "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      ) : (
        <Card>
          <Empty>No day has been closed yet. Tonight’s count starts the record.</Empty>
        </Card>
      )}
    </div>
  );
}

/**
 * `formatDate` expects a timestamp, and a bare "YYYY-MM-DD" leans on a
 * non-standard parse. Midday keeps the rendered day unambiguous either side of
 * the three-hour shift.
 */
function noonOn(date: string): string {
  return `${date} 12:00:00`;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tnum">{value}</dd>
    </div>
  );
}

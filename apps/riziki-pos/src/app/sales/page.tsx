import Link from "next/link";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { currentUser, requireOwner } from "@/lib/auth";
import { listSales, saleLinesFor, voidSale, SaleError, SALES_PAGE_SIZE } from "@/lib/sales";
import { formatKes, formatDateTime } from "@/lib/units";
import { Alert, Card, Chip, Empty, PageTitle, SectionLabel, inputClass } from "@/components/ui";
import { SectionNav, REPORT_SECTIONS } from "@/components/section-nav";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  mpesa: "M-Pesa",
  credit: "Credit",
};

/**
 * Void a sale. Owner only, and never a delete: the original stays on the list,
 * struck through, with the reason next to it, and the stock it took comes back
 * as a compensating ledger entry.
 */
async function voidAction(formData: FormData) {
  "use server";

  const owner = await requireOwner();
  const saleId = Number(formData.get("saleId"));
  const reason = String(formData.get("reason") ?? "");
  const page = String(formData.get("page") ?? "1");

  try {
    voidSale(saleId, owner.id, reason);
  } catch (err) {
    if (err instanceof SaleError) {
      redirect(`/sales?page=${page}&err=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  refresh();
}

export default async function SalesPage(props: {
  // `searchParams` is a Promise in Next.js 16 — synchronous access was removed.
  searchParams: Promise<{ page?: string; err?: string }>;
}) {
  const { page, err } = await props.searchParams;

  const user = await currentUser();
  if (!user) redirect("/login");
  const isOwner = user.role === "owner";

  const { rows, total, page: current, pages } = listSales(Number(page) || 1, SALES_PAGE_SIZE);
  const lines = saleLinesFor(rows.map((r) => r.id));

  return (
    <div>
      {/* The counter arrives here from the till and has to get back to it.
          There was no way but the menu, which on the till screen is now behind
          a hamburger — two taps to undo one. */}
      <Link
        href="/sell"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> Back to selling
      </Link>

      <PageTitle
        title="Sales"
        subtitle={`${total} sale${total === 1 ? "" : "s"} · newest first`}
      />
      <SectionNav sections={REPORT_SECTIONS} current="/sales" label="Reports" />

      {err ? (
        <div className="mb-3">
          <Alert tone="bad">{err}</Alert>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Empty>No sales yet. They will appear here as the counter records them.</Empty>
      ) : null}

      {/*
        One sale per row wasted three quarters of a laptop screen. The card is
        self-contained, so past `lg` it tiles: the list is read by scanning down
        a column, and two or three columns simply means less scrolling.
      */}
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:gap-3 2xl:grid-cols-3 3xl:grid-cols-4">
        {rows.map((s) => {
          const voided = s.status === "voided";
          const owing = s.total_cents - s.paid_cents;
          const methods = (s.methods ?? "")
            .split(",")
            .filter(Boolean)
            .map((m) => METHOD_LABEL[m] ?? m);
          const mine = lines.filter((l) => l.sale_id === s.id);

          return (
            <Card key={s.id} className={voided ? "opacity-70" : ""}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">
                    {formatDateTime(s.at)}
                    <span className="ml-1.5 font-normal text-muted">#{s.id}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {s.user_name ?? "unknown"}
                    {s.customer_name ? ` · ${s.customer_name}` : ""}
                    {` · ${s.line_count} line${s.line_count === 1 ? "" : "s"}`}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-lg font-extrabold tnum ${voided ? "text-muted line-through" : ""}`}
                  >
                    {formatKes(s.total_cents)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">
                    {methods.length ? methods.join(" + ") : "no payment"}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Chip tone={s.tier === "wholesale" ? "warn" : "neutral"}>
                  {s.tier === "wholesale" ? "Wholesale" : "Retail"}
                </Chip>
                {voided ? (
                  <Chip tone="bad">Voided</Chip>
                ) : owing > 0 ? (
                  <Chip tone="warn">{formatKes(owing)} unpaid</Chip>
                ) : (
                  <Chip tone="good">Paid</Chip>
                )}
                <Link
                  href={`/invoice/${s.id}`}
                  className="ml-auto text-xs font-bold text-brand-dark"
                >
                  Invoice →
                </Link>
              </div>

              {voided ? (
                <p className="mt-2 text-xs text-bad">
                  Voided by {s.voided_by_name ?? "owner"}
                  {s.voided_at ? ` on ${formatDateTime(s.voided_at)}` : ""} — {s.void_reason}
                </p>
              ) : null}

              {mine.length ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-bold text-brand">
                    What was sold
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {mine.map((l, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">
                          {l.units} × {l.name_snapshot}
                        </span>
                        <span className="text-muted tnum">
                          {formatKes(l.unit_price_cents)} → {formatKes(l.line_total_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {isOwner && !voided ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-muted">Void this sale…</summary>
                  <form action={voidAction} className="mt-2 space-y-2">
                    <input type="hidden" name="saleId" value={s.id} />
                    <input type="hidden" name="page" value={current} />
                    <input
                      className={inputClass}
                      name="reason"
                      placeholder="Why is it being voided?"
                      aria-label={`Reason for voiding sale ${s.id}`}
                      required
                    />
                    <button
                      type="submit"
                      className="flex min-h-11 w-full items-center justify-center rounded-xl bg-bad px-4 text-sm font-bold text-white xl:min-h-9"
                    >
                      Void {formatKes(s.total_cents)} and return the stock
                    </button>
                  </form>
                </details>
              ) : null}
            </Card>
          );
        })}
      </div>

      {pages > 1 ? (
        <>
          <SectionLabel>
            Page {current} of {pages}
          </SectionLabel>
          <div className="flex gap-2">
            {current > 1 ? (
              <Link
                href={`/sales?page=${current - 1}`}
                className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line bg-white px-4 text-sm font-bold xl:min-h-9"
              >
                ← Newer
              </Link>
            ) : null}
            {current < pages ? (
              <Link
                href={`/sales?page=${current + 1}`}
                className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line bg-white px-4 text-sm font-bold xl:min-h-9"
              >
                Older →
              </Link>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

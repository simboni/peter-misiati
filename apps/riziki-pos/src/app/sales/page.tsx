import Link from "next/link";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { currentUser, requirePermission, can } from "@/lib/auth";
import {
  listSales,
  saleFilterCounts,
  saleLinesFor,
  voidSale,
  SaleError,
  SALES_PAGE_SIZE,
  type SaleFilter,
} from "@/lib/sales";
import { listRange, readListPeriod } from "@/lib/list-range";
import { businessDate, formatKes, formatDateTime } from "@/lib/units";
import { Alert, Chip, Empty, PageTitle, TableWrap, Th, Td, inputClass } from "@/components/ui";
import { ListToolbar, Pager } from "@/components/section-nav";
import { DateBar } from "@/components/date-bar";
import { ExportButtons } from "@/components/export-buttons";

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

  const owner = await requirePermission("void");
  const saleId = Number(formData.get("saleId"));
  const reason = String(formData.get("reason") ?? "");
  // Everything the list was filtered by, carried back so a void does not dump
  // whoever did it at the top of an unfiltered page one.
  const back = String(formData.get("back") ?? "");

  try {
    voidSale(saleId, owner.id, reason);
  } catch (err) {
    if (err instanceof SaleError) {
      const sep = back.includes("?") ? "&" : "?";
      redirect(`/sales${back}${sep}err=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  refresh();
}

const STATES: Array<{ key: SaleFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unpaid", label: "Unpaid" },
  { key: "credit", label: "On account" },
  { key: "voided", label: "Voided" },
];

export default async function SalesPage(props: {
  // `searchParams` is a Promise in Next.js 16 — synchronous access was removed.
  searchParams: Promise<{
    page?: string;
    err?: string;
    q?: string;
    state?: string;
    period?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await props.searchParams;
  const { page, err } = sp;

  const user = await currentUser();
  if (!user) redirect("/login");
  // Two different questions on this screen: who may void a sale, and who may
  // see what a mixed product was made of — which is the recipe.
  const mayVoid = can(user, "void");
  const seesRecipe = can(user, "recipes");

  /*
    Search, dates and standing, together.

    This list is the shop's memory and it only grows. Somebody arrives at it
    with one of four questions — a name, a receipt number, a day, or "who still
    owes" — and until now the answer to every one of them was to turn pages.
  */
  const q = (sp.q ?? "").trim();
  const state: SaleFilter =
    STATES.some((s) => s.key === sp.state) ? (sp.state as SaleFilter) : "all";
  const period = readListPeriod(sp);
  const range = listRange(period, businessDate(), sp.from, sp.to);

  const { rows, total, page: current, pages } = listSales({
    page: Number(page) || 1,
    perPage: SALES_PAGE_SIZE,
    q,
    range,
    state,
  });
  const counts = saleFilterCounts(range, q);
  const lines = saleLinesFor(rows.map((r) => r.id));

  /* What every control has to carry so the others survive being used. */
  const dates: Record<string, string> = {};
  if (period !== "all") dates.period = period;
  if (sp.from) dates.from = sp.from;
  if (sp.to) dates.to = sp.to;

  const filters: Record<string, string> = { ...dates };
  if (q) filters.q = q;
  if (state !== "all") filters.state = state;

  const backTo = (() => {
    const p = new URLSearchParams(filters);
    if (current > 1) p.set("page", String(current));
    const str = p.toString();
    return str ? `?${str}` : "";
  })();

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
      <div className="mb-3">
        <ExportButtons csv="sales" label="the sales history" />
      </div>

      <DateBar
        action="/sales"
        current={period}
        range={range}
        from={sp.from ?? ""}
        to={sp.to ?? ""}
        keep={{ ...(q ? { q } : {}), ...(state !== "all" ? { state } : {}) }}
        label="Sold"
      />

      <ListToolbar
        action="/sales"
        q={q}
        placeholder="A customer, an attendant, or a receipt number…"
        filters={STATES.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] }))}
        current={state}
        extra={dates}
      />

      {err ? (
        <div className="mb-3">
          <Alert tone="bad">{err}</Alert>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Empty>
          {q || state !== "all" || period !== "all"
            ? "No sale matches. Widen the dates, change the standing, or clear the search."
            : "No sales yet. They will appear here as the counter records them."}
        </Empty>
      ) : null}

      {/*
        A list, not tiles.

        This was a grid of self-contained cards, two or three abreast. It read
        as a wall: the totals never lined up under each other, so "what did we
        take on the 14th" meant reading every tile instead of running an eye
        down one column.
      */}
      <TableWrap>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>Standing</Th>
            <Th align="right">Total</Th>
            <Th align="right">Do</Th>
          </tr>
        </thead>
        <tbody>
        {rows.map((s) => {
          const voided = s.status === "voided";
          const owing = s.total_cents - s.paid_cents;
          const methods = (s.methods ?? "")
            .split(",")
            .filter(Boolean)
            .map((m) => METHOD_LABEL[m] ?? m);
          /*
            The ingredients of a mixed product are the recipe, so they are the
            owner's to see and nobody else's — not the attendant on the counter
            phone, and never the customer, who gets neither this screen nor them
            on the receipt.
          */
          const mine = lines.filter(
            (l) => l.sale_id === s.id && (seesRecipe || !l.is_component),
          );

          return (
            <tr key={s.id} className={voided ? "opacity-60" : "hover:bg-wash/50"}>
              <Td className="whitespace-nowrap">
                <div className="text-[13px] font-bold">{formatDateTime(s.at)}</div>
                <div className="text-[11px] text-muted">
                  #{s.id} · {s.user_name ?? "unknown"}
                </div>
              </Td>
              <Td>
                <div className="text-[13px]">
                  {s.customer_name || <span className="text-muted">walk-in</span>}
                </div>
                <div className="text-[11px] text-muted">
                  {s.line_count} line{s.line_count === 1 ? "" : "s"}
                  {methods.length ? ` · ${methods.join(" + ")}` : " · no payment"}
                </div>
                {/* What was sold stays behind a fold: it is the answer to a
                    question asked of one row in fifty, and unfolded it would
                    turn a page of twenty sales into a page of four. */}
                {mine.length ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] font-bold text-brand">
                      What was sold
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {mine.map((l, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className="min-w-0 flex-1 truncate">
                            {l.units} × {l.name_snapshot}
                          </span>
                          <span className="text-muted tnum">{formatKes(l.line_total_cents)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {voided ? (
                  <p className="mt-1 text-[11px] text-bad">
                    Voided by {s.voided_by_name ?? "owner"}
                    {s.voided_at ? ` on ${formatDateTime(s.voided_at)}` : ""} — {s.void_reason}
                  </p>
                ) : null}
              </Td>
              <Td>
                <span className="flex flex-wrap gap-1.5">
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
                </span>
              </Td>
              <Td align="right">
                <span className={`font-extrabold ${voided ? "text-muted line-through" : ""}`}>
                  {formatKes(s.total_cents)}
                </span>
              </Td>
              <Td align="right">
                <span className="flex justify-end gap-1.5 whitespace-nowrap">
                  <Link
                    href={`/invoice/${s.id}`}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold hover:bg-wash"
                  >
                    Invoice
                  </Link>
                  {/* The paper that travels with the goods, and comes back signed. */}
                  <Link
                    href={`/delivery/${s.id}`}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold hover:bg-wash"
                  >
                    Note
                  </Link>
                  {mayVoid && !voided ? (
                    <details className="relative">
                      <summary className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-muted hover:bg-bad-soft hover:text-bad">
                        Void
                      </summary>
                      {/* Anchored over the row rather than pushing it open: a
                          void form that grows the row shoves the next twenty
                          sales down the page mid-read. */}
                      <form
                        action={voidAction}
                        className="absolute right-0 z-20 mt-1 w-64 space-y-2 rounded-xl border border-line bg-white p-2.5 text-left shadow-lift"
                      >
                        <input type="hidden" name="saleId" value={s.id} />
                        <input type="hidden" name="back" value={backTo} />
                        <input
                          className={inputClass}
                          name="reason"
                          placeholder="Why is it being voided?"
                          aria-label={`Reason for voiding sale ${s.id}`}
                          required
                        />
                        <button
                          type="submit"
                          className="flex min-h-11 w-full items-center justify-center rounded-xl bg-bad px-3 text-[12px] font-bold text-white xl:min-h-9"
                        >
                          Void and return the stock
                        </button>
                      </form>
                    </details>
                  ) : null}
                </span>
              </Td>
            </tr>
          );
        })}
        </tbody>
      </TableWrap>

      <Pager action="/sales" page={current} pages={pages} total={total} noun="sale" params={filters} />
    </div>
  );
}

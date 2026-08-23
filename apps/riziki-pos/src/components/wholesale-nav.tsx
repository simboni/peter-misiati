import Link from "next/link";

/**
 * The wholesale section's own menu.
 *
 * Wholesale is not one screen with a few buttons on it — it is the side of the
 * business that runs on documents, and the owner asked for it to be somewhere
 * you can stand and do all of it. So it has a spine: the same destinations on
 * every page inside it, in the same order, so nobody has to go back to a hub to
 * get from a quote to the money still outstanding on it.
 *
 * The destinations mirror the life of one order — you quote it, you invoice it,
 * and the customer is the thread through both.
 *
 * There used to be a fourth, "Debts", and it is gone on purpose. A debt is not a
 * separate thing from an invoice; it is an invoice whose paid amount is short of
 * its total, seen from the other side. Two screens for one fact meant two places
 * that could disagree — a voided bill still showing as owed, a part payment
 * counted once here and differently there — and it made the counter ask which
 * number was the true one. Now there is one list of invoices with an "Owing"
 * filter, and the per-customer view of the same money lives on Customers, where
 * the phone number to call is already sitting.
 */
export const WHOLESALE_SECTIONS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/wholesale", label: "Overview", exact: true },
  { href: "/wholesale/quotes", label: "Quotes" },
  { href: "/wholesale/invoices", label: "Invoices" },
  { href: "/wholesale/customers", label: "Customers" },
];

export function WholesaleNav({ current }: { current: string }) {
  return (
    <nav
      aria-label="Wholesale"
      className="no-print mb-4 flex gap-1 overflow-x-auto rounded-2xl bg-wash p-1 ring-1 ring-inset ring-line"
    >
      {WHOLESALE_SECTIONS.map((s) => {
        const on = s.exact ? current === s.href : current.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-bold transition-colors xl:min-h-9 ${
              on ? "bg-white text-brand-deep shadow-card" : "text-muted hover:text-ink"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The banner at the top of a section — the thing the owner asked to be large
 * and unmissable. A section is mostly history, and history is not why anyone
 * opened it; they came to raise the next one.
 */
export function NewBanner({
  href,
  title,
  blurb,
  cta,
}: {
  href: string;
  title: string;
  blurb: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="header-deep no-print relative mb-4 flex items-center gap-4 overflow-hidden rounded-3xl px-5 py-4 text-white shadow-lift transition-transform hover:-translate-y-0.5"
    >
      <div className="min-w-0 flex-1">
        <div className="text-lg font-extrabold tracking-tight xl:text-xl">{title}</div>
        <div className="mt-0.5 text-[13px] text-frost">{blurb}</div>
      </div>
      <span className="flex shrink-0 items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-bold ring-1 ring-inset ring-white/30">
        {cta}
        <span aria-hidden>→</span>
      </span>
      <span aria-hidden className="brand-thread absolute inset-x-0 bottom-0 h-[3px]" />
    </Link>
  );
}

/**
 * The way back.
 *
 * A real link to a named destination rather than a history-back button, and
 * deliberately so: `router.back()` is only meaningful if you know how somebody
 * arrived, and at a counter they arrive by every route there is — a tab, the
 * menu, a redirect after billing, or a phone left open since yesterday. A
 * button that sometimes leaves the app entirely is worse than one that always
 * goes somewhere predictable.
 *
 * It also survives being middle-clicked, and works with no JavaScript, which a
 * button does not.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="no-print mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
    >
      <span aria-hidden>←</span> {label}
    </Link>
  );
}

/**
 * Search, filter and paging for a list that will one day hold thousands.
 *
 * A plain form with a GET, and links for the filters and the pages. No client
 * state, which means the browser's back button works, a filtered list can be
 * bookmarked or sent to somebody, and the whole thing still functions on a
 * counter phone that has decided not to run JavaScript today.
 */
export function ListToolbar({
  action,
  q,
  placeholder,
  filters,
  current,
  extra,
}: {
  action: string;
  q: string;
  placeholder: string;
  filters: Array<{ key: string; label: string; count?: number }>;
  current: string;
  extra?: Record<string, string>;
}) {
  const href = (key: string) => {
    const p = new URLSearchParams({ ...(extra ?? {}) });
    if (q) p.set("q", q);
    if (key !== "all") p.set("state", key);
    const s = p.toString();
    return s ? `${action}?${s}` : action;
  };

  return (
    <div className="no-print mb-3 space-y-2">
      <form action={action} className="flex gap-2">
        {current !== "all" ? <input type="hidden" name="state" value={current} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          aria-label="Search"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm xl:min-h-10"
        />
        <button
          type="submit"
          className="flex min-h-11 shrink-0 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white xl:min-h-10"
        >
          Search
        </button>
        {q ? (
          <Link
            href={action}
            className="flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-bold text-muted hover:bg-wash xl:min-h-10"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={href(f.key)}
            aria-current={current === f.key ? "true" : undefined}
            className={`flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition-colors ${
              current === f.key
                ? "bg-brand text-white"
                : "bg-white text-muted ring-1 ring-inset ring-line hover:text-ink"
            }`}
          >
            {f.label}
            {typeof f.count === "number" ? (
              <span className={current === f.key ? "text-white/70 tnum" : "text-muted tnum"}>
                {f.count}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Pager({
  action,
  page,
  pages,
  total,
  noun,
  params,
}: {
  action: string;
  page: number;
  pages: number;
  total: number;
  noun: string;
  params: Record<string, string>;
}) {
  const to = (n: number) => {
    const p = new URLSearchParams(params);
    if (n > 1) p.set("page", String(n));
    else p.delete("page");
    const s = p.toString();
    return s ? `${action}?${s}` : action;
  };

  const step =
    "flex min-h-11 items-center rounded-xl px-4 text-sm font-bold xl:min-h-10";

  return (
    <div className="no-print mt-4 flex items-center gap-2">
      <span className="text-[12px] font-semibold text-muted tnum">
        {total} {noun}
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
      </span>
      <div className="ml-auto flex gap-2">
        {page > 1 ? (
          <Link href={to(page - 1)} className={`${step} bg-white text-brand-dark ring-1 ring-inset ring-line`}>
            ← Newer
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={to(page + 1)} className={`${step} bg-white text-brand-dark ring-1 ring-inset ring-line`}>
            Older →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

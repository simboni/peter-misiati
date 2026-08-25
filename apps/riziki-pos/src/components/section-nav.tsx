import Link from "next/link";

/**
 * A section's own menu — the spine that holds one part of the app together.
 *
 * Wholesale had this first and it was the right shape, so it is the shape all
 * of them use now. A section is not one screen with a few buttons on it; it is
 * a place you stand and do a whole job, and it needs the same destinations on
 * every page inside it, in the same order, so nobody has to go back out to a
 * hub to get from one to the next.
 *
 * The main navigation names the sections. This names what is inside one. Before
 * it was shared, "stock" meant a tab AND three entries under More, which is two
 * menus disagreeing about where a thing lives.
 */
export interface Section {
  href: string;
  label: string;
  /** Match only this exact path — for a section's own overview page. */
  exact?: boolean;
  /**
   * Hidden from an attendant. Filtered here rather than left to render and
   * bounce: a tab that takes you to "ask the owner" is a dead end you learn to
   * stop pressing, and it teaches the counter that the app is unreliable.
   */
  owner?: boolean;
}

export const WHOLESALE_SECTIONS: Section[] = [
  { href: "/wholesale", label: "Overview", exact: true },
  { href: "/wholesale/quotes", label: "Quotes" },
  { href: "/wholesale/invoices", label: "Invoices" },
  // Points out of the section on purpose. A wholesale buyer and a walk-in who
  // owes money are the same person to this shop, so there is one Customers
  // section and wholesale links into it rather than keeping a second copy.
  { href: "/customers", label: "Customers" },
];

/**
 * Everything the shop holds, and everything it sells.
 *
 * "Stock" used to be a tab and, separately, three entries under More — Stock
 * take, Recipes, Products & prices — so the answer to "where do I change a
 * price" depended on which menu you happened to be looking at. They are one
 * section now, in the order the work actually happens: see what is there, count
 * it, price it, record what it makes, record what was bought in.
 */
export const STOCK_SECTIONS: Section[] = [
  { href: "/stock", label: "On the shelf", exact: true },
  // A stock take reads raw-chemical quantities off the shelf, and those numbers
  // are how a recipe could be worked out by subtraction — so it stays owner
  // only, along with the rest of raw-chemical handling.
  { href: "/stocktake", label: "Stock take", owner: true },
  { href: "/items", label: "Products & prices", owner: true },
  { href: "/formulas", label: "Recipes", owner: true },
  { href: "/purchases", label: "Purchases" },
];

/**
 * The people who buy, and the money they owe.
 *
 * This was "Debts", which named a number rather than a person — and there were
 * two screens behind it, one listing debtors and one listing customers, showing
 * the same money from two angles. A debt is a fact about a customer, not a
 * separate thing, so the customer is the thing and the debt is a column on it.
 */
export const CUSTOMER_SECTIONS: Section[] = [
  { href: "/customers", label: "Everyone", exact: true },
  { href: "/customers/owing", label: "Owing" },
];

/**
 * The books.
 *
 * Reports is the owner's reading of the shop, so the spine holds the analysis
 * and the three records it is read against — what was sold, what prices moved,
 * and who did what.
 *
 * Day close and Expenses are deliberately not here. They are daily jobs an
 * attendant does, not readings an owner takes, and Reports is owner-only — a
 * spine entry an attendant can never reach is a spine entry that should not
 * exist. They stay under More, where the person who needs them will find them.
 */
export const REPORT_SECTIONS: Section[] = [
  { href: "/reports", label: "Summary", exact: true },
  { href: "/sales", label: "Sales history" },
  { href: "/prices/history", label: "Price history" },
  { href: "/activity", label: "Activity log" },
];

export function SectionNav({
  sections,
  current,
  label,
  isOwner = true,
}: {
  sections: Section[];
  current: string;
  label: string;
  isOwner?: boolean;
}) {
  const shown = sections.filter((s) => !s.owner || isOwner);
  return (
    <nav
      aria-label={label}
      className="no-print mb-4 flex gap-1 overflow-x-auto rounded-2xl bg-wash p-1 ring-1 ring-inset ring-line"
    >
      {shown.map((s) => {
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
/** The wholesale section's nav, kept as a name the existing pages already use. */
export function WholesaleNav({ current }: { current: string }) {
  return <SectionNav sections={WHOLESALE_SECTIONS} current={current} label="Wholesale" />;
}

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

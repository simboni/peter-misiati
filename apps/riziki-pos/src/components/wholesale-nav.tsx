import Link from "next/link";

/**
 * The wholesale section's own menu.
 *
 * Wholesale is not one screen with a few buttons on it — it is the side of the
 * business that runs on documents, and the owner asked for it to be somewhere
 * you can stand and do all of it. So it has a spine: the same five destinations
 * on every page inside it, in the same order, so nobody has to go back to a hub
 * to get from a quote to the debtors list.
 *
 * The destinations mirror the life of one order — you quote it, you invoice it,
 * you chase it, and the customer is the thread through all three.
 */
export const WHOLESALE_SECTIONS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/wholesale", label: "Overview", exact: true },
  { href: "/wholesale/quotes", label: "Quotes" },
  { href: "/wholesale/invoices", label: "Invoices" },
  { href: "/wholesale/debts", label: "Debts" },
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

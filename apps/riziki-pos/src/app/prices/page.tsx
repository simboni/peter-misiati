import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { priceList, checkState, ageOfPrice, STALE_DAYS } from "@/lib/pricing";
import { formatDateTime } from "@/lib/units";
import { PageTitle, Card, Empty } from "@/components/ui";
import { PriceSheet, type SheetRow } from "./price-sheet";

export const dynamic = "force-dynamic";

/**
 * Prices for today.
 *
 * Open to attendants, not just the owner. That is the point of it: the person
 * who opens the shop is the person who will be asked "how much is caustic
 * today", and until now they had to ring the owner to find out and ring him
 * again to have it changed. The floor price is what makes handing this over
 * safe — an attendant can raise anything and lower nothing past it.
 */
export default async function PricesPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { q = "" } = await props.searchParams;
  const state = checkState();
  const rows: SheetRow[] = priceList(q).map((r) => {
    const days = ageOfPrice(r.changed_at);
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      retail_cents: r.retail_cents,
      wholesale_cents: r.wholesale_cents,
      floor_cents: r.floor_cents,
      changed_at: r.changed_at,
      changed_by: r.changed_by,
      days,
      stale: days === null || days >= STALE_DAYS,
    };
  });

  return (
    <div>
      <Link
        href="/sell"
        className="no-print mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> Back to selling
      </Link>

      <PageTitle
        title="Prices for today"
        subtitle="Set what the shop is charging before the first customer"
      />

      {/* The state of the ritual, in one line. Not a nag — a fact the owner can
          also read when he asks whether prices were looked at this morning. */}
      <div
        className={`mb-4 rounded-2xl px-4 py-3 text-sm ${
          state.doneToday
            ? "bg-good-soft text-good"
            : "bg-warn-soft text-warn ring-1 ring-inset ring-warn/25"
        }`}
      >
        <span className="font-bold">
          {state.doneToday ? "Prices checked today." : "Prices not yet checked today."}
        </span>{" "}
        {state.lastAt ? (
          <span className="font-semibold">
            Last change {formatDateTime(state.lastAt)}
            {state.lastBy ? ` by ${state.lastBy}` : ""}.
          </span>
        ) : (
          <span className="font-semibold">No price has been changed through this screen yet.</span>
        )}{" "}
        {state.staleCount > 0 ? (
          <span>
            {state.staleCount} price{state.staleCount === 1 ? " has" : "s have"} not moved in{" "}
            {STALE_DAYS} days.
          </span>
        ) : null}
      </div>

      {/* Plain GET, so a search can be bookmarked and the back button works. */}
      <form action="/prices" className="no-print mb-3 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Find a chemical or product…"
          aria-label="Search items"
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
            href="/prices"
            className="flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-bold text-muted hover:bg-wash xl:min-h-10"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length ? (
        <PriceSheet rows={rows} staleDays={STALE_DAYS} />
      ) : (
        <Card>
          <Empty>
            {q
              ? "Nothing matches that. Try a different search, or clear it."
              : "Nothing is priced for sale yet."}
          </Empty>
        </Card>
      )}

      <div className="no-print mt-4 flex flex-wrap gap-4 text-sm font-bold text-brand">
        <Link href="/prices/history">Price history</Link>
        {user.role === "owner" ? <Link href="/items">Products &amp; prices</Link> : null}
      </div>
    </div>
  );
}

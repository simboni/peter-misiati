import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  debtors,
  totalOwed,
  listCustomers,
  waLink,
  reminderMessage,
  isOverLimit,
  AGE_LABEL,
  AGE_TONE,
  type AgeBand,
} from "@/lib/credit";
import { formatKes, formatDate } from "@/lib/units";
import { Alert, Card, PageTitle, Chip, Stat, Empty } from "@/components/ui";
import { ListToolbar, Pager } from "@/components/section-nav";
import { CustomerForm } from "./forms";

export const dynamic = "force-dynamic";

/** How many customers fit on one page before it becomes a scroll to nowhere. */
const PER_PAGE = 24;

type Filter = "all" | "owing" | "overdue" | "settled";

/**
 * The customers.
 *
 * This screen was "Debtors", and there was a second one under Wholesale called
 * "Customers" showing the same money from the other side. Two screens for one
 * set of people is two places to look and two answers to "does he owe us" —
 * so there is one now, and it is named after the person rather than after the
 * number, because the person is the thing that lasts.
 *
 * A debt is a filter on this list, not a screen of its own. That is the whole
 * consolidation: everything about a customer — what they owe, how old it is,
 * who to phone, how to add one, how to take one off — is reachable without
 * leaving the window.
 *
 * The owing chip is first and the page opens on it, because the shop lives or
 * dies on who owes what and for how long, and that is what the owner opens the
 * app to see.
 */
export default async function CustomersPage(props: {
  searchParams: Promise<{
    q?: string;
    state?: string;
    page?: string;
    removed?: string;
    kind?: string;
    err?: string;
  }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { q = "", state, page: pageParam, removed, kind, err } = await props.searchParams;
  const filter: Filter = (["owing", "overdue", "settled"] as const).includes(state as never)
    ? (state as Filter)
    : "all";
  const page = Math.max(1, Number(pageParam) || 1);

  const needle = q.trim().toLowerCase();
  const match = (name: string, phone: string) =>
    !needle || name.toLowerCase().includes(needle) || phone.includes(needle);

  const owing = debtors();
  const owingById = new Map(owing.map((r) => [r.id, r]));
  const everyone = listCustomers();

  /*
    One row shape for both halves of the list.

    A customer who owes nothing and a customer who owes 8,000 are the same row
    with a different balance on it, and treating them as two kinds of thing is
    what produced two screens in the first place.
  */
  const rows = everyone.map((c) => {
    const debt = owingById.get(c.id);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      kind: c.kind,
      creditLimitCents: c.credit_limit_cents,
      balanceCents: debt?.balance_cents ?? 0,
      openSales: debt?.open_sales ?? 0,
      oldestAt: debt?.oldest_at ?? "",
      band: (debt?.band ?? "none") as AgeBand,
    };
  });

  const counts = {
    all: rows.length,
    owing: rows.filter((r) => r.balanceCents > 0).length,
    overdue: rows.filter((r) => r.band === "old").length,
    settled: rows.filter((r) => r.balanceCents === 0).length,
  };

  const filtered = rows
    .filter((r) => match(r.name, r.phone))
    .filter((r) =>
      filter === "owing"
        ? r.balanceCents > 0
        : filter === "overdue"
          ? r.band === "old"
          : filter === "settled"
            ? r.balanceCents === 0
            : true,
    )
    // Biggest debt first, then alphabetical — the order the owner works it in.
    .sort((a, b) => b.balanceCents - a.balanceCents || a.name.localeCompare(b.name));

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const shown = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const owed = totalOwed();
  const overdueCents = rows.filter((r) => r.band === "old").reduce((s, r) => s + r.balanceCents, 0);

  return (
    <div>
      <PageTitle
        title="Customers"
        subtitle="Everyone who buys on account — what they owe, and who to call"
      />

      {err ? (
        <div className="mb-3 max-w-3xl">
          <Alert tone="bad">{err}</Alert>
        </div>
      ) : null}
      {removed ? (
        <div className="mb-3 max-w-3xl">
          <Alert tone="good">
            {kind === "hidden"
              ? `${removed} is hidden from the counter. Their invoices and quotations are untouched.`
              : `${removed} has been removed.`}
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:max-w-xl">
        <Stat
          label="Total owed"
          value={formatKes(owed)}
          detail={`${counts.owing} ${counts.owing === 1 ? "customer" : "customers"}`}
        />
        <Stat
          label="Over 30 days"
          value={formatKes(overdueCents)}
          detail={counts.overdue ? `${counts.overdue} to chase` : "nothing overdue"}
        />
      </div>

      <div className="mt-4">
        <ListToolbar
          action="/customers"
          q={q}
          placeholder="Search name or phone…"
          current={filter}
          filters={[
            { key: "all", label: "Everyone", count: counts.all },
            { key: "owing", label: "Owing", count: counts.owing },
            { key: "overdue", label: "Over 30 days", count: counts.overdue },
            { key: "settled", label: "Settled", count: counts.settled },
          ]}
        />
      </div>

      {/* Adding somebody is what you do the moment the search fails, so it sits
          right under the search box rather than at the bottom of the list. */}
      <details className="mb-3">
        <summary className="cursor-pointer text-sm font-bold text-brand-dark">
          ＋ New customer
        </summary>
        <Card className="mt-2 max-w-2xl">
          <CustomerForm />
        </Card>
      </details>

      {shown.length ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 xl:gap-3 3xl:grid-cols-4">
          {shown.map((r) => {
            const over = r.balanceCents > 0 && isOverLimit({ credit_limit_cents: r.creditLimitCents }, r.balanceCents);
            return (
              <Card key={r.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/customers/${r.id}`}
                      className="-my-1 block truncate py-1 font-bold text-ink"
                    >
                      {r.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted">
                      {r.phone || "no phone"} ·{" "}
                      {r.balanceCents > 0
                        ? `${r.openSales} unpaid ${r.openSales === 1 ? "sale" : "sales"} · since ${formatDate(r.oldestAt)}`
                        : r.kind === "wholesale"
                          ? "wholesale · settled"
                          : "settled"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={`text-base font-extrabold tnum ${r.balanceCents > 0 ? "text-ink" : "text-muted"}`}
                    >
                      {r.balanceCents > 0 ? formatKes(r.balanceCents) : "—"}
                    </div>
                    {r.balanceCents > 0 ? (
                      <div className="mt-1">
                        <Chip tone={AGE_TONE[r.band]}>{AGE_LABEL[r.band]}</Chip>
                      </div>
                    ) : null}
                  </div>
                </div>

                {over ? (
                  <p className="rounded-lg bg-bad-soft px-2.5 py-1.5 text-xs font-semibold text-bad">
                    Over the {formatKes(r.creditLimitCents)} limit agreed with this customer.
                  </p>
                ) : null}

                <div className="flex gap-2 pt-0.5">
                  <Link
                    href={`/customers/${r.id}`}
                    className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line px-3 text-xs font-bold hover:bg-wash xl:min-h-9"
                  >
                    {r.balanceCents > 0 ? "Record payment" : "Open"}
                  </Link>
                  {r.balanceCents > 0 ? (
                    /*
                      The shop already chases debts on WhatsApp, so the reminder
                      is a pre-typed wa.me deep link rather than a message we
                      send on the owner's behalf.
                    */
                    <a
                      href={waLink(r.phone, reminderMessage(r.name, r.balanceCents, r.oldestAt))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-good-soft px-3 text-center text-xs font-bold text-good xl:min-h-9"
                    >
                      Remind on WhatsApp
                    </a>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <Empty>
            {needle
              ? "Nobody matches that search."
              : filter === "owing" || filter === "overdue"
                ? "Nobody owes anything. Every sale is settled."
                : "No customers on file yet — add the first one above."}
          </Empty>
        </Card>
      )}

      <Pager
        action="/customers"
        page={page}
        pages={pages}
        total={filtered.length}
        noun="customer"
        params={{ ...(q ? { q } : {}), ...(filter !== "all" ? { state: filter } : {}) }}
      />
    </div>
  );
}

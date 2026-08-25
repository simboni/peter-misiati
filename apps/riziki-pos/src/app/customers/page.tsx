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
import { Alert, Card, PageTitle, Chip, Stat, Empty, TableWrap, Th, Td } from "@/components/ui";
import { ListToolbar, Pager } from "@/components/section-nav";
import { CustomerForm } from "./forms";

export const dynamic = "force-dynamic";

/**
 * How many fit on one page.
 *
 * Small on purpose. A list of everybody who has ever bought is not read; it is
 * searched. Fifteen rows plus the pager fit a laptop screen without scrolling
 * and about a phone-and-a-half, which is the point at which somebody stops
 * scrolling and starts typing in the search box — which is the faster way to
 * what they wanted anyway.
 */
const PER_PAGE = 15;

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
        /*
          A list, not a grid of cards.

          A card is for something you look at one of; this is a column of names
          you run your eye down looking for one. Fifteen rows here occupy the
          space five cards did, and the numbers line up under each other, which
          is what makes "who owes the most" answerable at a glance rather than
          by reading every tile.
        */
        <TableWrap>
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Phone</Th>
              <Th>Standing</Th>
              <Th align="right">Owed</Th>
              <Th align="right">Do</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const over =
                r.balanceCents > 0 &&
                isOverLimit({ credit_limit_cents: r.creditLimitCents }, r.balanceCents);
              return (
                <tr key={r.id} className="hover:bg-wash/50">
                  <Td>
                    <Link href={`/customers/${r.id}`} className="font-bold text-ink">
                      {r.name}
                    </Link>
                    {r.kind === "wholesale" ? (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                        wholesale
                      </span>
                    ) : null}
                    {over ? (
                      <div className="text-[11px] font-semibold text-bad">
                        over the {formatKes(r.creditLimitCents)} limit
                      </div>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{r.phone || "—"}</Td>
                  <Td>
                    {r.balanceCents > 0 ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Chip tone={AGE_TONE[r.band]}>{AGE_LABEL[r.band]}</Chip>
                        <span className="text-[11px] text-muted">
                          {r.openSales} unpaid · since {formatDate(r.oldestAt)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted">settled</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className={r.balanceCents > 0 ? "font-extrabold" : "text-muted"}>
                      {r.balanceCents > 0 ? formatKes(r.balanceCents) : "—"}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-1.5 whitespace-nowrap">
                      <Link
                        href={`/customers/${r.id}`}
                        className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold hover:bg-wash"
                      >
                        {r.balanceCents > 0 ? "Take payment" : "Open"}
                      </Link>
                      {r.balanceCents > 0 ? (
                        /* The shop already chases on WhatsApp, so this is a
                           pre-typed wa.me link rather than a message we send. */
                        <a
                          href={waLink(r.phone, reminderMessage(r.name, r.balanceCents, r.oldestAt))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg bg-good-soft px-2.5 py-1.5 text-[11px] font-bold text-good"
                        >
                          Remind
                        </a>
                      ) : null}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
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
        order="list"
        page={page}
        pages={pages}
        total={filtered.length}
        noun="customer"
        params={{ ...(q ? { q } : {}), ...(filter !== "all" ? { state: filter } : {}) }}
      />
    </div>
  );
}

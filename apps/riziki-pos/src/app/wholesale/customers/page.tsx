import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ageBand, ageDays, AGE_TONE } from "@/lib/credit";
import {
  wholesaleCustomers,
  customerStateCounts,
  type CustomerState,
} from "@/lib/wholesale-lists";
import { formatKes } from "@/lib/units";
import { Card, Empty, PageTitle } from "@/components/ui";
import { WholesaleNav, NewBanner, BackLink, ListToolbar, Pager } from "@/components/wholesale-nav";

export const dynamic = "force-dynamic";

/**
 * The buyers, and where each of them stands.
 *
 * This screen absorbed the debts list. A wholesale customer is only half a fact
 * without their balance — the question at this counter is never "who are they"
 * but "can they take another drum" — so the balance, how long it has been owed,
 * and the number to ring about it all sit on the same row.
 *
 * The other half of the same money is on the invoice list under "Owing", which
 * answers the other question: not who owes, but which bill. One arithmetic, two
 * ways in, and no third screen keeping its own score.
 */
const STATES: Array<{ key: CustomerState; label: string }> = [
  { key: "all", label: "All" },
  { key: "owing", label: "Owing" },
  { key: "wholesale", label: "Wholesale" },
  { key: "clear", label: "Clear" },
];

const TONE_CLASS: Record<string, string> = {
  good: "bg-good-soft text-good",
  neutral: "bg-wash text-muted",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
};

export default async function WholesaleCustomersPage(props: {
  searchParams: Promise<{ q?: string; state?: string; page?: number | string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim();
  const state = (STATES.find((s) => s.key === sp.state)?.key ?? "all") as CustomerState;
  const page = Number(sp.page ?? 1) || 1;

  const { rows, total, pages, page: current } = wholesaleCustomers({ q, state, page });
  const counts = customerStateCounts();

  return (
    <div>
      <BackLink href="/wholesale" label="Wholesale" />
      <PageTitle title="Customers" subtitle="Who buys on account, what they owe, and for how long" />
      <WholesaleNav current="/wholesale/customers" />

      <NewBanner
        href="/customers"
        title="Add a customer"
        blurb="Names, numbers, KRA PINs and credit limits — set the terms before the first bill."
        cta="Open"
      />

      <ListToolbar
        action="/wholesale/customers"
        q={q}
        placeholder="Name, phone number, or KRA PIN…"
        filters={STATES.map((s) => ({ ...s, count: counts[s.key] ?? 0 }))}
        current={state}
      />

      {rows.length ? (
        <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-ink/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-wash text-left text-[10px] uppercase tracking-[0.12em] text-muted">
                <th className="px-3 py-2">Customer</th>
                <th className="hidden px-3 py-2 sm:table-cell">Phone</th>
                <th className="hidden px-3 py-2 lg:table-cell">Credit limit</th>
                <th className="px-3 py-2 text-right">Owing</th>
                <th className="px-3 py-2 text-right">Oldest</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                // Ageing comes from the oldest bill still short of its total —
                // the same rule the debtors book used, applied to the same rows.
                const days = c.oldest_at ? ageDays(c.oldest_at) : 0;
                const band = c.balance_cents > 0 ? ageBand(days) : "none";
                const overLimit =
                  c.credit_limit_cents > 0 && c.balance_cents > c.credit_limit_cents;
                return (
                  <tr key={c.id} className="border-t border-line hover:bg-wash/60">
                    <td className="px-3 py-2">
                      <Link
                        href={`/customers/${c.id}`}
                        className="block font-bold text-ink hover:text-brand"
                      >
                        {c.name}
                      </Link>
                      <span className="text-[11px] text-muted tnum sm:hidden">
                        {c.phone || "no number"}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 text-muted tnum sm:table-cell">
                      {c.phone || "—"}
                    </td>
                    <td className="hidden px-3 py-2 text-[12px] lg:table-cell">
                      {c.credit_limit_cents === 0 ? (
                        <span className="text-muted">no terms agreed</span>
                      ) : (
                        <span className={overLimit ? "font-bold text-bad tnum" : "text-muted tnum"}>
                          {formatKes(c.credit_limit_cents)}
                          {overLimit ? " · over" : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tnum">
                      {c.balance_cents > 0 ? (
                        <>
                          <span className="block font-bold text-warn">
                            {formatKes(c.balance_cents)}
                          </span>
                          {/* On its own line: beside the figure, a bare count
                              reads as more digits of the amount. */}
                          <span className="block text-[10px] font-semibold text-muted">
                            {c.open_sales} bill{c.open_sales === 1 ? "" : "s"}
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] font-bold uppercase text-good">clear</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {c.balance_cents > 0 ? (
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide tnum ${
                            TONE_CLASS[AGE_TONE[band]] ?? "bg-wash text-muted"
                          }`}
                        >
                          {days}d
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Card>
          <Empty>
            {q || state !== "all"
              ? "Nobody matches that. Try a different search, or clear the filter."
              : "No customers on the books yet. One is created automatically the first time a bill goes on account, at a zero limit until the owner agrees terms."}
          </Empty>
        </Card>
      )}

      <Pager
        action="/wholesale/customers"
        page={current}
        pages={pages}
        total={total}
        noun="customers"
        params={{ ...(q ? { q } : {}), ...(state !== "all" ? { state } : {}) }}
      />
    </div>
  );
}

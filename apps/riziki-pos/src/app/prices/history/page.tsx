import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { priceHistory } from "@/lib/pricing";
import { formatKes, formatDateTime } from "@/lib/units";
import { PageTitle, Card, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * What prices used to be.
 *
 * The reason the price check writes history rather than just overwriting a
 * column: a customer says "last week it was nine hundred", and somebody has to
 * be able to answer that with a record instead of a memory. It also shows the
 * owner what the counter has been doing with the freedom he just handed over.
 */
export default async function PriceHistoryPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const rows = priceHistory(undefined, 120);

  return (
    <div>
      <Link
        href="/prices"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> Prices
      </Link>
      <PageTitle title="Price history" subtitle="Every change, who made it, and what it was before" />

      {rows.length ? (
        <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-ink/5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-wash text-left text-[10px] uppercase tracking-[0.12em] text-muted">
                <th className="px-3 py-2">Item</th>
                <th className="hidden px-3 py-2 sm:table-cell">When</th>
                <th className="hidden px-3 py-2 lg:table-cell">By</th>
                <th className="px-3 py-2 text-right">Retail</th>
                <th className="hidden px-3 py-2 text-right lg:table-cell">Wholesale</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const up = r.new_retail > r.old_retail;
                const same = r.new_retail === r.old_retail;
                return (
                  <tr key={`${r.at}-${i}`} className="border-t border-line">
                    <td className="px-3 py-2">
                      <span className="block font-bold leading-tight">{r.item_name}</span>
                      <span className="text-[11px] text-muted sm:hidden">
                        {formatDateTime(r.at)}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 text-[12px] text-muted sm:table-cell">
                      {formatDateTime(r.at)}
                    </td>
                    <td className="hidden px-3 py-2 text-[12px] text-muted lg:table-cell">
                      {r.user_name ?? "—"}
                      {r.source === "admin" ? (
                        <span className="ml-1 text-[10px] uppercase">· catalogue</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tnum">
                      {same ? (
                        <span className="text-muted">unchanged</span>
                      ) : (
                        <>
                          <span className="text-muted line-through">
                            {formatKes(r.old_retail)}
                          </span>{" "}
                          <span className={`font-bold ${up ? "text-bad" : "text-good"}`}>
                            {formatKes(r.new_retail)}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 text-right tnum lg:table-cell">
                      {r.new_wholesale === r.old_wholesale ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <>
                          <span className="text-muted line-through">
                            {formatKes(r.old_wholesale)}
                          </span>{" "}
                          <span className="font-bold">{formatKes(r.new_wholesale)}</span>
                        </>
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
          <Empty>No price has been changed yet. The first change will appear here.</Empty>
        </Card>
      )}
    </div>
  );
}

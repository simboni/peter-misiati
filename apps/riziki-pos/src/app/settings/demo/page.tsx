import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadDemoData, clearTradingData, tradingCounts, DemoError } from "@/lib/demo";
import { authoriseOwnerPin } from "@/lib/sales";
import { PageTitle, Card, SectionLabel, Alert } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Demo data in, and everything out again.
 *
 * Owner-only, and the clear needs the word CLEAR typed and the owner's PIN.
 * Two gates rather than one because this is the single most destructive button
 * in the app and it lives two taps from the till: the PIN says who, and typing
 * the word says they meant it, which a mis-tap on a phone cannot do.
 */
const LABELS: Record<string, string> = {
  sales: "Sales and invoices",
  payments: "Payments",
  customers: "Customers",
  quotes: "Quotes",
  purchases: "Purchases",
  expenses: "Expenses",
  stock_movements: "Stock movements",
  price_changes: "Price history",
  day_closes: "Day closes",
};

async function load(): Promise<void> {
  "use server";
  const owner = await requireOwner();
  try {
    const s = loadDemoData(owner.id);
    revalidatePath("/", "layout");
    redirect(
      `/settings/demo?ok=${encodeURIComponent(
        `Loaded ${s.sales} sales, ${s.customers} customers, ${s.purchases} deliveries, ${s.quotes} quotes and ${s.expenses} expenses.`,
      )}`,
    );
  } catch (e) {
    if (e instanceof DemoError) redirect(`/settings/demo?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

async function clear(formData: FormData): Promise<void> {
  "use server";
  const owner = await requireOwner();

  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "CLEAR") {
    redirect(`/settings/demo?err=${encodeURIComponent("Type CLEAR to confirm.")}`);
  }
  if (!authoriseOwnerPin(String(formData.get("pin") ?? ""))) {
    redirect(`/settings/demo?err=${encodeURIComponent("That PIN was not recognised.")}`);
  }

  try {
    const removed = clearTradingData(owner.id);
    revalidatePath("/", "layout");
    const total = Object.values(removed).reduce((a, b) => a + b, 0);
    redirect(
      `/settings/demo?ok=${encodeURIComponent(
        `Cleared ${total} records. The catalogue, staff and settings are untouched.`,
      )}`,
    );
  } catch (e) {
    if (e instanceof DemoError) redirect(`/settings/demo?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

export default async function DemoDataPage(props: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requireOwner();
  const { ok, err } = await props.searchParams;
  const counts = tradingCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div>
      <Link
        href="/settings"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> Settings
      </Link>
      <PageTitle
        title="Demo data"
        subtitle="Fill the shop with a month of trading to try it out, then clear it before you go live"
      />

      {ok ? <div className="mb-4"><Alert tone="good">{ok}</Alert></div> : null}
      {err ? <div className="mb-4"><Alert tone="bad">{err}</Alert></div> : null}

      <SectionLabel>What is in the shop now</SectionLabel>
      <Card>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
          {Object.entries(counts).map(([k, n]) => (
            <div key={k} className="flex items-baseline justify-between gap-2 border-b border-line py-1">
              <dt className="text-muted">{LABELS[k] ?? k}</dt>
              <dd className="font-bold tnum">{n}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <SectionLabel>Load demo data</SectionLabel>
      <Card>
        <p className="text-sm leading-relaxed text-muted">
          Adds twelve customers, three suppliers, six deliveries, about ninety sales — some paid,
          some part paid, some on account — a handful of quotes in every state, the month&rsquo;s
          expenses and a few price changes. It is written the same way real trading is, so stock,
          costs, debts and reports all add up.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          It adds to whatever is already here rather than replacing it. Run it twice and you get
          twice the trading.
        </p>
        <form action={load} className="mt-4">
          <button
            type="submit"
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-dark"
          >
            Load a month of demo trading
          </button>
        </form>
      </Card>

      <SectionLabel>Clear everything traded</SectionLabel>
      <Card className="ring-1 ring-bad/25">
        <p className="text-sm leading-relaxed text-ink">
          Removes <strong>all {total} trading records</strong> — every sale, payment, customer,
          quote, delivery, expense, stock movement and price change, demo or real. There is no undo.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your products, chemicals, formulas, staff and settings are <strong>not</strong> touched.
          Stock counts return to zero, because stock is the sum of its movements — enter opening
          stock with a stock take afterwards.
        </p>
        <p className="mt-2 text-sm font-semibold text-warn">
          Take a backup first. Settings → Backup writes a copy you can restore from.
        </p>

        <form action={clear} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
              Type CLEAR to confirm
            </span>
            <input
              name="confirm"
              autoComplete="off"
              placeholder="CLEAR"
              className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold uppercase"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
              Owner&rsquo;s PIN
            </span>
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm"
            />
          </label>
          <button
            type="submit"
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-bad px-5 text-sm font-bold text-white shadow-sm hover:brightness-110"
          >
            Clear all trading data
          </button>
        </form>
      </Card>
    </div>
  );
}

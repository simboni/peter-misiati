import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { formatKes, formatQty, businessDate } from "@/lib/units";
import { Stat, SectionLabel, Card, Chip, Alert } from "@/components/ui";
import { usersOnDemoPin } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const owner = user.role === "owner";
  const today = businessDate();

  // Sales are stored in UTC; group them in shop time or the evening's takings
  // land on tomorrow's report and the cash count won't agree.
  const todayRow = all<{ total: number; n: number }>(
    `SELECT COALESCE(SUM(total_cents),0) AS total, COUNT(*) AS n
       FROM sales
      WHERE status = 'completed'
        AND date(at, '+3 hours') = ?`,
    today,
  )[0];

  const owed = all<{ owed: number }>(
    `SELECT COALESCE(SUM(s.total_cents - s.paid_cents), 0) AS owed
       FROM sales s
      WHERE s.status = 'completed' AND s.total_cents > s.paid_cents`,
  )[0];

  const lowStock = all<{ name: string; qty_milli: number; canonical_unit: string }>(
    `SELECT i.name, COALESCE(SUM(m.delta_milli),0) AS qty_milli, i.canonical_unit
       FROM items i
       LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.active = 1 AND i.reorder_level_milli > 0
      GROUP BY i.id
     HAVING qty_milli <= i.reorder_level_milli
      ORDER BY qty_milli ASC
      LIMIT 6`,
  );

  // The one "you left something unfinished" state that belongs on the front
  // door: an evening where money was taken and the day was never closed.
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }).format(
      new Date(),
    ),
  );
  const dayUnclosed =
    hour >= 17 &&
    (todayRow?.n ?? 0) > 0 &&
    !get(`SELECT 1 FROM day_closes WHERE business_date = ?`, today);

  // The starting-PIN warning lived only on Settings, which is easy to never open.
  // The home screen is the one everyone sees, so it belongs here too.
  const demoPin = owner ? usersOnDemoPin() : [];

  return (
    <div>
      {demoPin.length > 0 ? (
        <div className="mb-3">
          <Alert tone="bad">
            <strong>Change the starting PINs before the shop opens.</strong>{" "}
            {demoPin.map((u) => u.name).join(" and ")}{" "}
            {demoPin.length === 1 ? "still opens" : "still open"} with the PIN the system
            shipped with.{" "}
            <Link href="/settings" className="font-bold underline">
              Fix in Settings
            </Link>
          </Alert>
        </div>
      ) : null}
      <h1 className="mb-1 text-[22px] font-bold tracking-tight text-brand-deep">Today</h1>
      <p className="mb-4 text-sm text-muted">
        {new Date().toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Africa/Nairobi",
        })}
      </p>

      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-8">
      <div className="lg:col-span-7 xl:col-span-8">
      {/* A number you can't act on is a dead end — both stats are doors. */}
      <div className="grid grid-cols-2 gap-2.5">
        <Link href="/sales" className="block">
          <Stat
            label="Sales today"
            value={formatKes(todayRow?.total ?? 0)}
            detail={`${todayRow?.n ?? 0} sales · see them →`}
          />
        </Link>
        <Link href="/customers" className="block">
          <Stat label="Owed to you" value={formatKes(owed?.owed ?? 0)} detail="open the debtors book →" />
        </Link>
      </div>

      {dayUnclosed ? (
        <div className="mt-3">
          <Link href="/day-close" className="block">
            <Alert tone="warn">
              <strong>The day hasn&rsquo;t been closed.</strong> Count the drawer before locking
              up — tap to close the day.
            </Alert>
          </Link>
        </div>
      ) : null}

      <SectionLabel>Needs attention</SectionLabel>
      {lowStock.length ? (
        <Card className="space-y-2.5">
          {lowStock.map((r) => (
            <Link
              key={r.name}
              href={`/stock?q=${encodeURIComponent(r.name)}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-sm font-semibold">{r.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted tnum">
                  {formatQty(r.qty_milli, r.canonical_unit)}
                </span>
                <Chip tone={r.qty_milli <= 0 ? "bad" : "warn"}>
                  {r.qty_milli <= 0 ? "Out" : "Low"}
                </Chip>
              </span>
            </Link>
          ))}
          <div className="flex flex-wrap gap-x-4 pt-1">
            <Link href="/stock" className="text-sm font-bold text-brand-dark">
              View all stock →
            </Link>
            <Link href="/purchases" className="text-sm font-bold text-brand-dark">
              Record a delivery →
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted">Every item is above its reorder level.</p>
        </Card>
      )}

      </div>

      <div className="lg:col-span-5 xl:col-span-4">
      {/* Three doors, not eleven — the full menu already lives on the More tab. */}
      <SectionLabel>Shortcuts</SectionLabel>
      <div className="grid grid-cols-3 gap-2.5 lg:grid-cols-1">
        {[
          { href: "/day-close", label: "Day close" },
          { href: "/sales", label: "Sales history" },
          { href: "/expenses", label: "Expenses" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex min-h-14 items-center justify-center rounded-2xl bg-white px-3 text-center text-sm font-semibold text-ink shadow-card ring-1 ring-ink/5 transition-shadow hover:shadow-lift"
          >
            {l.label}
          </Link>
        ))}
      </div>
      </div>
      </div>
    </div>
  );
}

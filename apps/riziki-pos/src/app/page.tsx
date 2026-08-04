import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { formatKes, formatQty, businessDate } from "@/lib/units";
import { Stat, SectionLabel, Card, Chip, Alert } from "@/components/ui";
import { MoreMenu } from "@/components/nav";
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
      <h1 className="mb-1 text-xl font-bold tracking-tight">Today</h1>
      <p className="mb-4 text-sm text-muted">
        {new Date().toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Africa/Nairobi",
        })}
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="Sales today" value={formatKes(todayRow?.total ?? 0)} detail={`${todayRow?.n ?? 0} sales`} />
        <Stat label="Owed to you" value={formatKes(owed?.owed ?? 0)} detail="unpaid balances" />
      </div>

      <SectionLabel>Needs attention</SectionLabel>
      {lowStock.length ? (
        <Card className="space-y-2.5">
          {lowStock.map((r) => (
            <div key={r.name} className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{r.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted tnum">
                  {formatQty(r.qty_milli, r.canonical_unit)}
                </span>
                <Chip tone={r.qty_milli <= 0 ? "bad" : "warn"}>
                  {r.qty_milli <= 0 ? "Out" : "Low"}
                </Chip>
              </span>
            </div>
          ))}
          <Link href="/stock" className="block pt-1 text-sm font-bold text-brand">
            View all stock →
          </Link>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted">Every item is above its reorder level.</p>
        </Card>
      )}

      <SectionLabel>Everything else</SectionLabel>
      <MoreMenu isOwner={owner} />
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  INDICATORS, dashboard, series, months, present, presentChange,
  attendancesByVillage, minDenominator, smallCell,
  type Category, type Card as IndicatorCard, type Series,
} from "@/lib/indicators.ts";
import { today } from "@/lib/db.ts";
import { Shell, Section, Empty, Views } from "@/app/_components/shell.tsx";

/**
 * The dashboard.
 *
 * Every other screen in this system answers "what is happening now". This one
 * answers "is it getting better", which is the only question a manager actually
 * has — and every figure on it carries its definition, so nobody has to take it
 * on trust.
 */

const CATEGORY_LABEL: Record<Category, string> = {
  clinical: "Clinical",
  operations: "Operations",
  money: "Money",
  compliance: "Compliance",
};

/**
 * A sparkline.
 *
 * Deliberately small and unlabelled: it is there to show a shape, and the
 * numbers beside it are the thing to read. Points the module withheld are
 * simply absent rather than drawn as zero, which would invent a collapse.
 */
function Spark({ points }: { points: (number | null)[] }) {
  const known = points.map((value, index) => ({ value, index })).filter((p) => p.value !== null) as {
    value: number;
    index: number;
  }[];
  if (known.length < 2) return <span className="text-xs text-muted">not enough periods</span>;

  const values = known.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 120;
  const height = 28;

  const at = (p: { value: number; index: number }) => ({
    x: (p.index / Math.max(1, points.length - 1)) * width,
    y: height - ((p.value - min) / span) * (height - 4) - 2,
  });

  const path = known.map((p, i) => `${i === 0 ? "M" : "L"}${at(p).x.toFixed(1)},${at(p).y.toFixed(1)}`).join(" ");
  const last = at(known[known.length - 1]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand" />
      <circle cx={last.x} cy={last.y} r="2.5" className="fill-brand" />
    </svg>
  );
}

function Card({ card, trend }: { card: IndicatorCard; trend: Series }) {
  const { definition, now, changed, direction } = card;
  const tone =
    changed === null ? "text-muted"
    : changed > 0 ? "text-good"
    : changed < 0 ? "text-block"
    : "text-muted";

  return (
    <div className="bg-white border border-line rounded p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{definition.name}</p>
          <p className={`mt-1 text-xl font-semibold ${now.value === null ? "text-sm text-muted font-normal" : ""}`}>
            {present(now, definition)}
          </p>
          <p className="text-xs mt-1">
            {changed === null ? (
              <span className="text-muted">no comparison — one of the two periods was withheld</span>
            ) : (
              <span className={tone}>
                {direction === "up" ? "▲" : direction === "down" ? "▼" : "▪"} {presentChange(card)}
              </span>
            )}
          </p>
        </div>
        <Spark points={trend.points.map((p) => p.value)} />
      </div>

      <p className="mt-2 text-xs text-muted">
        {definition.numerator}
        {definition.denominator === "—" ? "" : ` ÷ ${definition.denominator}`}
      </p>
      <p className="mt-1 text-xs flex flex-wrap gap-2">
        <Link href={definition.drillTo} className="text-brand hover:underline">the rows behind it →</Link>
        <span className="text-muted">{definition.source}</span>
      </p>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "report.read")) redirect("/");

  const params = await searchParams;
  const view = (params.view ?? "all") as Category | "all";
  const category = view === "all" ? undefined : view;

  const cards = dashboard(user.facilityId, category);
  const periods = months(6);
  const trends = new Map(
    cards.map((card) => [card.definition.key, series(card.definition.key, user.facilityId, periods)]),
  );

  const monthStart = `${today().slice(0, 7)}-01`;
  const villages = attendancesByVillage(user.facilityId, monthStart, today());
  const denominatorFloor = minDenominator();
  const cellFloor = smallCell();

  return (
    <Shell
      user={user}
      current="/dashboard"
      error={params.error}
      title="Is it getting better?"
      subtitle="The last 30 days against the 30 before, with six months of shape beside each. Every figure says what it is made of."
    >
      <Views
        current={view}
        views={[
          { key: "all", label: "Everything", href: "/dashboard" },
          { key: "clinical", label: "Clinical", href: "/dashboard?view=clinical" },
          { key: "operations", label: "Operations", href: "/dashboard?view=operations" },
          { key: "money", label: "Money", href: "/dashboard?view=money" },
          { key: "compliance", label: "Compliance", href: "/dashboard?view=compliance" },
        ]}
      />

      {(["clinical", "operations", "money", "compliance"] as Category[])
        .filter((group) => !category || group === category)
        .map((group) => {
          const inGroup = cards.filter((card) => card.definition.category === group);
          if (inGroup.length === 0) return null;
          return (
            <Section key={group} title={CATEGORY_LABEL[group]}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {inGroup.map((card) => (
                  <Card key={card.definition.key} card={card} trend={trends.get(card.definition.key)!} />
                ))}
              </div>
            </Section>
          );
        })}

      {view === "all" ? (
        <Section
          title="Attendances by where people live"
          note={`This month. Any place with ${cellFloor} or fewer is not shown — and where that leaves a single withheld row, a second goes with it, because otherwise the total gives the first one away.`}
        >
          {villages.cells.length === 0 ? (
            <Empty>Nobody has been seen this month yet.</Empty>
          ) : (
            <div className="bg-white border border-line rounded divide-y divide-line">
              {villages.cells.map((cell) => (
                <div key={cell.label} className="px-3 py-2 text-sm flex justify-between">
                  <span>{cell.label}</span>
                  {cell.suppressed ? (
                    <span className="text-muted text-xs">withheld — too few people</span>
                  ) : (
                    <span>{cell.count}</span>
                  )}
                </div>
              ))}
              {villages.suppressedTotal > 0 ? (
                <div className="px-3 py-2 text-xs text-muted">
                  {villages.suppressedTotal} attendance{villages.suppressedTotal === 1 ? "" : "s"} sit in
                  withheld rows. The total above is therefore lower than the attendance count, on purpose.
                </div>
              ) : null}
            </div>
          )}
        </Section>
      ) : null}

      <Section title="How to read this">
        <div className="bg-white border border-line rounded p-3 text-sm space-y-2">
          <p>
            <strong>A percentage on fewer than {denominatorFloor} cases is not shown.</strong> One caesarean in
            two deliveries is not a 50% caesarean rate, it is two deliveries. Below the floor the count is
            shown instead, because a rate built on four cases will swing forty points next week and somebody
            will make a decision on the swing.
          </p>
          <p>
            <strong>Every indicator names its numerator, its denominator and where it came from.</strong> A
            figure with no denominator is one that cannot be checked, and a dashboard nobody can check is a
            dashboard people argue with instead of acting on.
          </p>
          <p>
            <strong>These are management indicators, not clinical quality measures.</strong> A real indicator
            set — MOH's, SHA's, or a programme's — has case definitions this system does not encode. Section
            20 of the clinical review register says which.
          </p>
        </div>
      </Section>
    </Shell>
  );
}

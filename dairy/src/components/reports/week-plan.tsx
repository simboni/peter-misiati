/**
 * What needs doing this week.
 *
 * One line per job: who, which animal, what action, by when. Grouped by the
 * person who has to do it, because the screen is read out at the morning
 * briefing and nobody wants to filter it in their head.
 */
import Link from "next/link";
import { Card, Chip, EmptyState } from "@/components/ui";
import type { WeekPlan, WeekTask } from "@/server/reports";
import { ReportHeader } from "./conclusion";

const SOURCE_ICON: Record<string, string> = {
  BREEDING: "♥",
  HEALTH: "💉",
  FEED: "🌾",
  MILK: "🥛",
  PEOPLE: "👥",
  MONEY: "💰",
};

function TaskLine({ t }: { t: WeekTask }) {
  const tone =
    t.severity === "CRITICAL" ? "border-danger" : t.severity === "WARN" ? "border-brass" : "border-line";
  return (
    <li className={`border-l-4 ${tone} bg-surface py-2 pl-3 pr-2`}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span aria-hidden>{SOURCE_ICON[t.source] ?? "•"}</span>
        <span className="font-medium">
          {t.animalId ? (
            <Link href={`/herd/${t.animalId}`} className="underline">
              {t.subject}
            </Link>
          ) : (
            t.subject
          )}
        </span>
        <span className="text-sm">{t.action}</span>
        <Chip tone={t.daysOverdue > 0 ? "danger" : t.severity === "WARN" ? "warn" : "neutral"}>
          {t.dueLabel}
        </Chip>
      </p>
      {t.detail ? <p className="mt-0.5 text-xs text-ink-3">{t.detail}</p> : null}
    </li>
  );
}

export function WeekPlanView({ r }: { r: WeekPlan }) {
  const groups = new Map<string, WeekTask[]>();
  for (const t of r.tasks) {
    const list = groups.get(t.whoLabel) ?? [];
    list.push(t);
    groups.set(t.whoLabel, list);
  }

  return (
    <div className="space-y-5">
      <ReportHeader
        title="What needs doing this week"
        period={`${r.asOf} to ${r.through}`}
        sentence={r.sentence}
        actions={[]}
        tone={r.criticalCount > 0 ? "danger" : "brand"}
      />

      {r.tasks.length === 0 ? (
        <EmptyState
          title="Nothing is waiting"
          hint="Every cow, every routine and every feed store is where it should be."
        />
      ) : (
        [...groups.entries()].map(([who, tasks]) => (
          <Card key={who}>
            <h2 className="text-lg font-semibold">
              {who} <span className="text-sm font-normal text-ink-3">· {tasks.length}</span>
            </h2>
            <ul className="mt-3 space-y-2">
              {tasks.map((t, i) => (
                <TaskLine key={`${t.kind}-${t.animalId ?? t.subject}-${i}`} t={t} />
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}

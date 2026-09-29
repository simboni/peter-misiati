import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, can } from "@/lib/auth";
import { checkBooks, type Severity } from "@/lib/health";
import { Alert, Card, Chip, Empty, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Things worth a second look.
 *
 * WHY. The shop found a day that made no sense, and working out why took an
 * export, a spreadsheet and somebody who knew what to compare against what. The
 * errors behind it were all the same shape — a quantity or a container size
 * typed wrong on a delivery — and not one of them announced itself. A cost
 * price is just a number; nothing about 2,000 a kilo looks wrong until you know
 * the next drum came in at 132.
 *
 * So the comparisons live in the app and the shop can run them whenever it
 * likes, against everything rather than against whatever happened to be on
 * screen.
 *
 * IT NEVER SAYS SOMETHING IS WRONG. It says it is worth checking. The shop has
 * the delivery note and this does not: a 0.42 kg delivery of EDTA is bizarre
 * and might be a genuine sample. Every row says what was seen and what to do,
 * and links to the screen where it can be put right — none of it is fixed from
 * here, because a list that can change the books is a list nobody dares run.
 */

const TONE: Record<Severity, "bad" | "warn" | "neutral"> = {
  high: "bad",
  medium: "warn",
  low: "neutral",
};

const WORD: Record<Severity, string> = {
  high: "Worth fixing",
  medium: "Worth knowing",
  low: "Worth a glance",
};

export default async function CheckPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user, "cost")) {
    return (
      <div>
        <PageTitle title="Worth checking" />
        <Alert tone="bad">
          This reads what the shop paid, so it is the owner’s. He can grant it under Users and
          settings.
        </Alert>
      </div>
    );
  }

  const { findings, counts, checked } = checkBooks();

  return (
    <div>
      <Link
        href="/more"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-brand hover:underline xl:min-h-9"
      >
        <span aria-hidden>←</span> More
      </Link>

      <PageTitle
        title="Worth checking"
        subtitle="Entries that do not look like the rest — the app comparing the books against themselves"
      />

      <Card className="mb-4">
        <p className="text-sm text-muted">
          {checked.items} product{checked.items === 1 ? "" : "s"} and {checked.deliveries} delivery
          line{checked.deliveries === 1 ? "" : "s"} were compared against each other and against
          what you ask for them.
        </p>
        {findings.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(["high", "medium"] as Severity[]).map((s) =>
              counts[s] ? (
                <Chip key={s} tone={TONE[s]}>
                  {counts[s]} {WORD[s].toLowerCase()}
                </Chip>
              ) : null,
            )}
          </div>
        ) : null}
        <p className="mt-2.5 text-xs text-muted">
          Nothing here is a verdict. You have the delivery note and this does not — a strange
          quantity might be a genuine sample. Nothing on this screen changes anything; each row
          links to where it can be put right.
        </p>
      </Card>

      {findings.length === 0 ? (
        <Empty>
          Nothing stood out. Every delivery landed at a rate like its neighbours, every container
          was the size that thing comes in, and nothing is priced under what it costs.
        </Empty>
      ) : (
        <ul className="space-y-2.5">
          {findings.map((f) => (
            <li
              key={f.id}
              className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-ink/5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                  {f.kind}
                </span>
                <Chip tone={TONE[f.severity]}>{WORD[f.severity]}</Chip>
              </div>

              <h2 className="mt-1 text-base font-bold leading-snug">{f.title}</h2>
              <p className="mt-1 text-sm text-muted">{f.detail}</p>

              {f.fix ? (
                <p className="mt-1.5 text-sm">
                  <span className="font-semibold">What to do: </span>
                  <span className="text-muted">{f.fix}</span>
                </p>
              ) : null}

              {f.href ? (
                <p className="mt-2 text-sm">
                  <Link href={f.href} className="font-bold text-brand hover:underline">
                    Open it →
                  </Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-muted">
        Run this after a week of deliveries, or whenever a figure looks wrong. A cost price entered
        wrongly is quiet: it does not fail, it just makes everything built on it slightly — or
        wildly — untrue, and keeps doing so until somebody compares it with something.
      </p>
    </div>
  );
}

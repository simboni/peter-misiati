import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, can } from "@/lib/auth";
import { checkBooks, type Finding, type Severity } from "@/lib/health";
import { setAside } from "@/lib/dismissals";
import { listRange, readListPeriod, LIST_PERIOD_LABEL } from "@/lib/list-range";
import { businessDate } from "@/lib/units";
import { describeRange } from "@/lib/reports";
import { Alert, Card, Chip, Empty, PageTitle } from "@/components/ui";
import { DateBar } from "@/components/date-bar";
import { SetAside, BringBack } from "./set-aside";

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
 *
 * THE ONE BUTTON THAT ACTS. Every row here is worked out afresh from the shop's
 * figures, so fixing the thing makes the row vanish on the next load and there
 * has never been anything to tick off. What that leaves out is the judgement a
 * check cannot make: the delivery note says the drum really was 5 kg, the price
 * really is right. Those rows never go, and a list carrying four of them that
 * will never clear is a list the shop stops reading — which costs more than the
 * rows are worth.
 *
 * So "I have corrected this" sets a row aside, and sets aside only what it then
 * said. The figures move, the row comes back. It changes nothing in the books;
 * it changes what this screen shows, which is the whole of its power.
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

/**
 * One finding, as a card.
 *
 * Lifted out of the page when the list became two lists. Declared at module
 * scope rather than inside the page function — the inline server action in
 * `SetAside` has to be able to reach it without it being captured in a
 * closure, which is the rule this codebase has already been bitten by twice.
 */
function Row({ f }: { f: Finding }) {
  return (
    <li className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-ink/5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
          {f.kind}
          {/* The day it happened, where there is one — and only where the
              finding has not already said it. Half these titles read
              "Ungerol on 2026-10-23 landed at…", and printing the date twice
              on one line is how a screen starts looking like a database. */}
          {f.at && !f.title.includes(f.at) ? (
            <span className="ml-1.5 font-semibold normal-case tracking-normal">{f.at}</span>
          ) : null}
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

      <SetAside keyName={f.id} said={f.detail} />
    </li>
  );
}

export default async function CheckPage(props: {
  // A Promise in Next.js 16 — synchronous access was removed.
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const sp = await props.searchParams;
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

  /*
    WHICH DAYS, AND WHY THE DEFAULT IS ALL OF THEM.

    The shop asked for this screen to take dates — "what went wrong yesterday"
    is a question somebody actually has, and a list carrying three months of
    findings is one nobody finishes reading.

    But the default stays **All**. A check screen that opens on Today would
    show an empty page every morning before the first delivery, and an empty
    check screen reads as "nothing is wrong" — which is the one thing this
    screen must never say when it is not true. Narrowing is something the owner
    does on purpose; it is not something the screen does to them.
  */
  const period = readListPeriod(sp);
  const range = listRange(period, businessDate(), sp.from, sp.to);

  const { findings, dated, standing, counts, checked, outsideWindow } = checkBooks(range);
  const aside = setAside();

  const windowName = period === "custom" && range ? describeRange(range) : LIST_PERIOD_LABEL[period].toLowerCase();

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

      <DateBar
        action="/check"
        current={period}
        range={range}
        from={sp.from ?? ""}
        to={sp.to ?? ""}
        label="Things that happened"
        allLabel="Everything, however long ago"
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
        {outsideWindow ? (
          /*
            The cost of narrowing, printed where the narrowing happened.

            Not a warning — the owner chose the dates and is entitled to them.
            It is the one sentence that stops a short list being read as a
            clean shop, with the way back to the whole of it beside it.
          */
          <p className="mt-2.5 text-sm">
            <span className="font-semibold text-ink">
              {outsideWindow} more {outsideWindow === 1 ? "finding is" : "findings are"} outside
              these dates.
            </span>{" "}
            <Link href="/check" className="font-bold text-brand hover:underline">
              Show everything →
            </Link>
          </p>
        ) : null}
        <p className="mt-2.5 text-xs text-muted">
          Nothing here is a verdict. You have the delivery note and this does not — a strange
          quantity might be a genuine sample. Nothing on this screen changes anything; each row
          links to where it can be put right.
        </p>
      </Card>

      {findings.length === 0 ? (
        <Empty>
          {range
            ? `Nothing happened ${windowName} that looks out of place, and nothing is standing wrong today.`
            : "Nothing stood out. Every delivery landed at a rate like its neighbours, every container was the size that thing comes in, and nothing is priced under what it costs."}
        </Empty>
      ) : null}

      {/*
        TWO LISTS, AND THE REASON THEY ARE NOT ONE.

        A finding is either something that HAPPENED on a day — a delivery typed
        wrong on the Tuesday, a sale costed at a fifth of its price at 09:43 —
        or something that IS, right now: a product with no price, a shelf below
        zero, two rows one name would reach. The dates govern the first kind.
        Nothing governs the second, because a standing fault is as true today
        as it was in March and narrowing to Yesterday does not mend it.

        Mixed into one list those two kinds are indistinguishable, and a window
        would appear to clear faults it has not touched. So they are separated
        and the second is labelled, which costs a heading and buys a screen
        that cannot mislead.
      */}
      {dated.length ? (
        <section className="mb-5">
          {range ? (
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
              What happened — {windowName}
            </h2>
          ) : null}
          <ul className="space-y-2.5">
            {dated.map((f) => (
              <Row key={f.id} f={f} />
            ))}
          </ul>
        </section>
      ) : null}

      {standing.length ? (
        <section className="mb-5">
          <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            True right now
          </h2>
          <p className="mb-2 text-xs text-muted">
            These have no date on them — they are how the shop stands today, not something that
            happened on a day. Picking dates above does not hide them.
          </p>
          <ul className="space-y-2.5">
            {standing.map((f) => (
              <Row key={f.id} f={f} />
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        The way to get a second opinion without handing over the shop.

        Working out why a day came out wrong used to mean four separate exports
        and a conversation about which of them carried customer names. The shop
        should not have to make that judgement in a hurry.
      */}
      <div className="mt-5 rounded-2xl border border-line bg-white p-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
          Asking somebody else to look
        </div>
        <p className="mt-1 text-sm text-muted">
          One file with the figures behind all of this — deliveries and what they landed at, every
          line sold with its cost, the shelf, what moved, what was mixed, and the day-by-day
          totals. <span className="font-semibold text-ink">No customer names, no phone numbers,
          no staff names, no notes, no PINs</span> — those columns are emptied before the file is
          written, not left to whoever presses the button.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <a
            href="/support?period=month"
            className="inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-sm font-bold text-white xl:min-h-10"
          >
            This month
          </a>
          <a
            href="/support?period=last-month"
            className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold text-brand-dark ring-1 ring-inset ring-line hover:bg-wash xl:min-h-10"
          >
            Last month
          </a>
          <a
            href="/support"
            className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold text-brand-dark ring-1 ring-inset ring-line hover:bg-wash xl:min-h-10"
          >
            Everything
          </a>
        </div>
      </div>

      {/*
        What has been set aside, and never fewer words than that.

        A dismissal that cannot be seen is a dismissal nobody can argue with, and
        six months later "the check says we are fine" would mean "the check says
        we are fine except for the eleven things somebody waved away in March".
        So they are listed, with what each one said, when, and one tap to put it
        back on the list.
      */}
      {aside.length ? (
        <details className="mt-5 rounded-2xl bg-white p-4 shadow-card ring-1 ring-ink/5">
          <summary className="cursor-pointer text-sm font-bold text-brand-deep">
            {aside.length} set aside
            <span className="ml-1.5 font-semibold text-muted">
              — corrected, or judged to be right as they are
            </span>
          </summary>
          <ul className="mt-3 space-y-2.5">
            {aside.map((d) => (
              <li key={d.key} className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
                <p className="text-[13px] leading-snug text-muted">{d.said}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                  <span className="text-[11px] font-semibold text-muted">
                    Set aside {d.at.slice(0, 10)}
                  </span>
                  <BringBack keyName={d.key} />
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="mt-4 text-xs text-muted">
        Run this after a week of deliveries, or whenever a figure looks wrong. A cost price entered
        wrongly is quiet: it does not fail, it just makes everything built on it slightly — or
        wildly — untrue, and keeps doing so until somebody compares it with something.
      </p>
    </div>
  );
}

import Link from "next/link";
import { getFacility, LEVELS } from "@/lib/facility.ts";
import { licenceStatus } from "@/lib/access.ts";
import { countOpen } from "@/lib/notifications.ts";
import { queue } from "@/lib/frontdesk.ts";
import { worklist } from "@/lib/pharmacy.ts";
import { pendingOrders, unacknowledged } from "@/lib/orders.ts";
import { bedBoard } from "@/lib/inpatient.ts";
import { listStores } from "@/lib/inventory.ts";
import { outstandingInvoices, etimsBacklog, formatKes } from "@/lib/billing.ts";
import { claimsSummary } from "@/lib/claims.ts";
import { preauthWorklist } from "@/lib/payers.ts";
import { outstandingNotifications } from "@/lib/reporting.ts";
import { deadLetters } from "@/lib/integration.ts";
import { unsettledClaims } from "@/lib/remittance.ts";
import { defaulters } from "@/lib/programmes.ts";
import { ancDefaulters } from "@/lib/maternity.ts";
import { signOutAction } from "@/app/actions/session.ts";
import { navFor, type BadgeKey } from "./nav.ts";
import type { CurrentUser } from "@/lib/auth.ts";

/**
 * The frame every screen sits in.
 *
 * A left sidebar grouped by department, because that is how a facility is
 * organised and because a system this size cannot show its own breadth through
 * a row of tabs — a client looking at twelve tabs cannot tell whether there is
 * anything behind them.
 *
 * Deliberately a component each page renders rather than a Next.js layout:
 * layouts do not re-render on navigation, and every count in this sidebar would
 * go stale the moment somebody moved between screens. A stale number on a claim
 * clock is worse than no number.
 */

/** Every live count, computed once. Each is the reason its link matters. */
function counts(facilityId: number): Record<BadgeKey, { text: string; tone: "block" | "clock" | "quiet" } | null> {
  const store = listStores(facilityId).find((s) => s.dispensing);
  const counter = store ? worklist(store.code) : [];
  const bench = pendingOrders("lab");
  const unread = unacknowledged();
  const beds = bedBoard(facilityId);
  const owed = outstandingInvoices(facilityId);
  const claims = claimsSummary();
  const preauth = preauthWorklist().filter((p) => p.status === "requested");
  const etims = etimsBacklog();
  const notifiable = outstandingNotifications(facilityId);
  const dead = deadLetters();
  const alerts = countOpen(facilityId);
  const unsettled = unsettledClaims(facilityId, 30);
  const missed = defaulters();
  const ancMissed = ancDefaulters();
  const waiting = queue(facilityId);

  const n = (
    value: number,
    tone: "block" | "clock" | "quiet" = "quiet",
  ): { text: string; tone: "block" | "clock" | "quiet" } | null => (value > 0 ? { text: String(value), tone } : null);

  return {
    waiting: n(waiting.length, waiting.some((v) => v.priority === "emergency") ? "block" : "quiet"),
    counter: n(counter.length, counter.some((c) => c.short) ? "clock" : "quiet"),
    bench: n(bench.length, bench.some((o) => o.priority === "stat") ? "block" : "quiet"),
    unread: n(unread.length, unread.some((u) => u.panic) ? "block" : unread.length ? "clock" : "quiet"),
    beds: beds.some((b) => b.occupied)
      ? { text: `${beds.filter((b) => b.occupied).length}/${beds.filter((b) => !b.bed.out_of_service).length}`, tone: "quiet" }
      : null,
    owed: owed.length
      ? { text: formatKes(owed.reduce((s, o) => s + o.balanceCents, 0)), tone: owed.some((o) => o.ageDays > 90) ? "block" : "quiet" }
      : null,
    claims: n(claims.closingSoon.length + claims.overdue.length, claims.overdue.length ? "block" : "clock"),
    preauth: n(preauth.length, preauth.some((p) => p.daysWaiting > 2) ? "clock" : "quiet"),
    etims: n(etims.queued, etims.queued > 10 ? "block" : "clock"),
    notifiable: n(notifiable.length, notifiable.some((x) => x.daysWaiting > 2) ? "block" : "clock"),
    deadLetters: n(dead.length, "block"),
    unsettled: n(unsettled.length, unsettled.some((c) => c.days > 60) ? "block" : "clock"),
    defaulters: n(missed.length, missed.some((d) => d.lost) ? "block" : "clock"),
    antenatal: n(ancMissed.length, "clock"),
    alerts: n(alerts.total, alerts.critical > 0 ? "block" : "clock"),
  };
}

export function Shell({
  user,
  current,
  title,
  subtitle,
  children,
  actions,
  error,
}: {
  user: CurrentUser;
  /** The href of the link that should read as selected. */
  current: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** A refusal from a server action, carried back on the URL by `act`. */
  error?: string;
}) {
  const facility = getFacility(user.facilityId)!;
  const licence = licenceStatus(user.userId);
  const groups = navFor(user.granted);
  const badge = counts(user.facilityId);
  const alerts = badge.alerts;

  const badgeTone = {
    block: "bg-block text-white",
    clock: "bg-clock-soft text-clock",
    quiet: "bg-brand-soft text-brand-dark",
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      {/* ---- the sidebar ------------------------------------------------ */}
      <aside className="bg-brand text-white lg:min-h-dvh lg:sticky lg:top-0 lg:self-start lg:h-dvh lg:overflow-y-auto">
        <div className="px-4 py-4 border-b border-white/10">
          <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-white/50">Afya Core</div>
          <Link href="/" className="block text-base font-bold tracking-tight leading-tight mt-0.5">
            {facility.name}
          </Link>
          <p className="text-[11px] text-white/50 tnum mt-0.5">
            KMHFL {facility.kmhfl_code} · Level {facility.level}
          </p>
        </div>

        <nav className="px-2 py-3">
          {groups.map((group) => (
            <div key={group.title} className="mb-3">
              <div className="px-2 pb-1 text-[10px] font-bold tracking-[0.14em] uppercase text-white/40">
                {group.title}
              </div>
              {group.links.map((link) => {
                const selected = link.href === current;
                const count = link.badge ? badge[link.badge] : null;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-[13px] leading-tight ${
                      selected ? "bg-wash text-ink font-semibold" : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    <span className="flex-1">{link.label}</span>
                    {count ? (
                      <span
                        className={`tnum text-[10px] font-bold rounded-full px-1.5 py-px shrink-0 ${
                          selected ? "bg-brand text-white" : badgeTone[count.tone]
                        }`}
                      >
                        {count.text}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-white/10 mt-auto">
          <Link
            href="/notifications"
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-[13px] -mx-2 ${
              current === "/notifications" ? "bg-wash text-ink font-semibold" : "text-white/80 hover:bg-white/10"
            }`}
          >
            <span className="flex-1">Alerts</span>
            {alerts ? (
              <span className={`tnum text-[10px] font-bold rounded-full px-1.5 py-px ${badgeTone[alerts.tone]}`}>
                {alerts.text}
              </span>
            ) : null}
          </Link>

          <div className="mt-3 pt-3 border-t border-white/10">
            <p className="text-[13px] font-medium leading-tight">{user.name}</p>
            <p className="text-[11px] text-white/50 tnum leading-tight mt-0.5">
              {licence.state === "current"
                ? `${licence.regulator} ${licence.number}`
                : licence.state === "expired"
                  ? `${licence.regulator} licence expired`
                  : "No licence on file"}
            </p>
            <form action={signOutAction}>
              <button type="submit" className="text-[11px] text-white/70 underline underline-offset-2 mt-1">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* ---- the screen ------------------------------------------------- */}
      <main className="px-5 py-6 max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-line">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-sm text-muted mt-0.5">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>

        {/* The domain modules refuse things in sentences meant to be read. This
            is where those sentences land. */}
        {error ? (
          <div className="mt-4">
            <Banner tone="block">{error}</Banner>
          </div>
        ) : null}

        {children}
      </main>
    </div>
  );
}

/** A figure with its caption. The unit of every summary strip in the system. */
export function Stat({
  label,
  value,
  note,
  tone = "ink",
  href,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "ink" | "good" | "clock" | "block" | "muted";
  href?: string;
}) {
  const colour = {
    ink: "text-ink",
    good: "text-good",
    clock: "text-clock",
    block: "text-block",
    muted: "text-muted",
  }[tone];

  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-bold tnum mt-0.5 ${colour}`}>{value}</div>
      {note ? <div className="text-xs text-muted mt-0.5 tnum">{note}</div> : null}
    </>
  );

  return href ? (
    <Link href={href} className="bg-white border border-line rounded px-4 py-3 hover:border-brand">
      {body}
    </Link>
  ) : (
    <div className="bg-white border border-line rounded px-4 py-3">{body}</div>
  );
}

/** A coloured banner. Used for the same three meanings everywhere. */
export function Banner({
  tone,
  children,
}: {
  tone: "good" | "clock" | "block" | "info";
  children: React.ReactNode;
}) {
  const classes = {
    good: "bg-good-soft border-good/25 text-good",
    clock: "bg-clock-soft border-clock/25 text-clock",
    block: "bg-block-soft border-block/25 text-block",
    info: "bg-brand-soft border-brand/20 text-brand-dark",
  }[tone];
  return <div className={`border rounded px-4 py-3 text-sm font-medium ${classes}`}>{children}</div>;
}

export function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">{title}</h2>
      {note ? <p className="text-xs text-muted mt-1">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** What a screen says when the thing it shows has not happened yet. */
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="bg-white border border-line border-dashed rounded px-4 py-6 text-sm text-muted text-center">
      {children}
    </p>
  );
}

/** The within-screen tab strip, for screens that hold several views. */
export function Views({
  current,
  views,
}: {
  current: string;
  views: { key: string; label: string; href: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1 mt-4">
      {views.map((v) => (
        <Link
          key={v.key}
          href={v.href}
          className={`text-[13px] font-medium rounded px-3 py-1.5 ${
            v.key === current ? "bg-brand text-white" : "bg-white border border-line hover:border-brand"
          }`}
        >
          {v.label}
        </Link>
      ))}
    </div>
  );
}

import Link from "next/link";
import { getFacility, LEVELS } from "@/lib/facility.ts";
import { licenceStatus } from "@/lib/access.ts";
import { countOpen } from "@/lib/notifications.ts";
import { signOutAction } from "@/app/actions/session.ts";
import type { CurrentUser } from "@/lib/auth.ts";

/**
 * The frame every screen sits in.
 *
 * Deliberately a component each page renders rather than a Next.js layout:
 * layouts do not re-render on navigation, and the number in the notification
 * badge would go stale the moment somebody moved between screens. A stale
 * count on a claim clock is worse than no count.
 *
 * Navigation is filtered by capability, not hidden by role name. A pharmacist
 * does not see the claims screen because they cannot submit claims, which is
 * the same fact that would stop them if they typed the URL.
 */

export interface NavItem {
  href: string;
  label: string;
  permission?: string;
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/queue", label: "Queue", permission: "queue.manage" },
  { href: "/appointments", label: "Appointments", permission: "queue.manage" },
  { href: "/patients", label: "Patients", permission: "patient.read" },
  { href: "/ward", label: "Ward", permission: "patient.read" },
  { href: "/pharmacy", label: "Pharmacy", permission: "dispense.perform" },
  { href: "/laboratory", label: "Laboratory", permission: "lab.result.release" },
  { href: "/stock", label: "Stock", permission: "report.read" },
  { href: "/claims", label: "Claims", permission: "claim.prepare" },
  { href: "/reports", label: "Reports", permission: "report.read" },
  { href: "/admin", label: "Administration", permission: "facility.configure" },
];

export function Shell({
  user,
  current,
  title,
  subtitle,
  children,
  actions,
}: {
  user: CurrentUser;
  current: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const facility = getFacility(user.facilityId)!;
  const licence = licenceStatus(user.userId);
  const open = countOpen(user.facilityId);

  const visible = NAV.filter((item) => !item.permission || user.granted.includes(item.permission));

  return (
    <div className="min-h-dvh">
      <header className="bg-brand text-white">
        <div className="max-w-6xl mx-auto px-5 pt-4 pb-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-white/60">
                Afya Core
              </div>
              <Link href="/" className="text-lg font-bold tracking-tight">
                {facility.name}
              </Link>
              <p className="text-xs text-white/60 tnum">
                KMHFL {facility.kmhfl_code} · Level {facility.level} — {LEVELS[facility.level]}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-white/60 tnum">
                {licence.state === "current"
                  ? `${licence.regulator} ${licence.number}`
                  : licence.state === "expired"
                    ? `${licence.regulator} licence expired`
                    : "No licence on file"}
              </p>
              <form action={signOutAction}>
                <button type="submit" className="text-xs text-white/75 underline underline-offset-2 mt-1">
                  Sign out
                </button>
              </form>
            </div>
          </div>

          <nav className="flex gap-0.5 mt-4 -mb-px overflow-x-auto">
            {visible.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 text-[13px] font-medium px-3 py-2 rounded-t border-b-2 ${
                  item.href === current
                    ? "bg-wash text-ink border-wash"
                    : "text-white/75 border-transparent hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/notifications"
              className={`shrink-0 text-[13px] font-medium px-3 py-2 rounded-t border-b-2 ml-auto flex items-center gap-1.5 ${
                current === "/notifications"
                  ? "bg-wash text-ink border-wash"
                  : "text-white/75 border-transparent hover:text-white"
              }`}
            >
              Alerts
              {open.total > 0 ? (
                <span
                  className={`tnum text-[11px] font-bold rounded-full px-1.5 py-px ${
                    open.critical > 0 ? "bg-block text-white" : "bg-white/20 text-white"
                  }`}
                >
                  {open.total}
                </span>
              ) : null}
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-7">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-line">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-sm text-muted mt-0.5">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
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

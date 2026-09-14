import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { facilityCompliance, getFacility, listDevices, LEVELS } from "@/lib/facility.ts";
import { expiringLicences, listUsers } from "@/lib/users.ts";
import { licenceStatus, can } from "@/lib/access.ts";
import { verifyAuditChain } from "@/lib/db.ts";
import { signOutAction } from "@/app/actions/session.ts";

/**
 * The compliance dashboard.
 *
 * This is the first screen deliberately. A facility owner's question is never
 * "what does the software do" — it is "am I going to get paid, and am I going to
 * pass an inspection". Everything here answers one of those two, and nothing
 * here is decorative.
 */
export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const facility = getFacility(user.facilityId)!;
  const flags = facilityCompliance(user.facilityId);
  const expiring = expiringLicences(user.facilityId, 60);
  const staff = listUsers(user.facilityId);
  const devices = listDevices(user.facilityId);
  const chain = verifyAuditChain();
  const myLicence = licenceStatus(user.userId);

  const critical = flags.filter((f) => f.severity === "critical");
  const warnings = flags.filter((f) => f.severity === "warning");

  return (
    <main className="max-w-4xl mx-auto px-5 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-line">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-muted">Afya Core</div>
          <h1 className="text-2xl font-bold tracking-tight mt-1">{facility.name}</h1>
          <p className="text-sm text-muted mt-1 tnum">
            KMHFL {facility.kmhfl_code} · Level {facility.level} — {LEVELS[facility.level]}
            {facility.county ? ` · ${facility.county}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted">
            {myLicence.state === "current"
              ? `${myLicence.regulator} ${myLicence.number} · to ${myLicence.expiresOn}`
              : myLicence.state === "expired"
                ? `${myLicence.regulator} licence expired ${myLicence.expiresOn}`
                : "No licence on file"}
          </p>
          <form action={signOutAction}>
            <button type="submit" className="text-xs text-brand underline underline-offset-2 mt-1.5">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* ---- blocking items first: these stop the facility being paid ---- */}
      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Blocking</h2>
        {critical.length === 0 ? (
          <p className="mt-3 bg-good-soft border border-good/25 text-good rounded px-4 py-3 text-sm font-medium">
            Nothing is blocking claims or invoicing.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {critical.map((f) => (
              <li key={f.key} className="bg-block-soft border border-block/25 rounded px-4 py-3">
                <p className="text-sm font-semibold text-block">{f.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- things that will start blocking if ignored ---- */}
      {warnings.length > 0 || expiring.length > 0 ? (
        <section className="mt-7">
          <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Expiring</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {warnings.map((f) => (
              <li key={f.key} className="bg-clock-soft border border-clock/25 rounded px-4 py-3">
                <p className="text-sm font-medium text-clock">{f.message}</p>
              </li>
            ))}
            {expiring.map((l) => (
              <li
                key={`${l.user_id}-${l.licence_number}`}
                className="bg-clock-soft border border-clock/25 rounded px-4 py-3 flex flex-wrap gap-x-3 gap-y-1 items-baseline"
              >
                <span className="text-sm font-medium text-clock">{l.name}</span>
                <span className="text-sm text-clock tnum">
                  {l.regulator} {l.licence_number}
                </span>
                <span className="text-sm text-clock ml-auto tnum">
                  {l.days_left < 0
                    ? `expired ${Math.abs(l.days_left)} days ago`
                    : `${l.days_left} days left`}
                </span>
              </li>
            ))}
          </ul>
          {expiring.length > 0 ? (
            <p className="text-xs text-muted mt-2 leading-relaxed">
              A lapsed licence switches off prescribing, diagnosis and discharge for that person, because
              claims citing an expired licence are rejected.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ---- the evidence an inspector asks for ---- */}
      <section className="mt-7 grid gap-3 sm:grid-cols-3">
        <div className="bg-white border border-line rounded px-4 py-3">
          <div className="text-xs text-muted">Staff accounts</div>
          <div className="text-2xl font-bold tnum mt-0.5">{staff.filter((s) => s.active).length}</div>
          <div className="text-xs text-muted mt-0.5">{staff.length} total, no shared logins</div>
        </div>
        <div className="bg-white border border-line rounded px-4 py-3">
          <div className="text-xs text-muted">Registered devices</div>
          <div className="text-2xl font-bold tnum mt-0.5">{devices.filter((d) => !d.revoked_at).length}</div>
          <div className="text-xs text-muted mt-0.5">
            {devices.filter((d) => d.revoked_at).length} revoked
          </div>
        </div>
        <div className="bg-white border border-line rounded px-4 py-3">
          <div className="text-xs text-muted">Audit chain</div>
          <div className={`text-2xl font-bold tnum mt-0.5 ${chain.ok ? "text-good" : "text-block"}`}>
            {chain.ok ? "Intact" : "Broken"}
          </div>
          <div className="text-xs text-muted mt-0.5 tnum">
            {chain.ok ? `${chain.checked} entries verified` : `breaks at entry #${chain.failedAtId}`}
          </div>
        </div>
      </section>

      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Today</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/patients" className="bg-brand text-white font-semibold rounded px-4 py-2.5 text-sm">
            Find a patient
          </Link>
          {can(user.userId, "patient.register") ? (
            <Link
              href="/patients/new"
              className="border border-brand text-brand font-semibold rounded px-4 py-2.5 text-sm"
            >
              Register a patient
            </Link>
          ) : null}
        </div>
      </section>

      <footer className="mt-8 pt-5 border-t border-line">
        <p className="text-xs text-muted leading-relaxed">
          Phase 1 in progress — platform, identity, audit, offline sync and the patient index are in.
          Encounters, billing and the claim scrubber follow.
        </p>
      </footer>
    </main>
  );
}

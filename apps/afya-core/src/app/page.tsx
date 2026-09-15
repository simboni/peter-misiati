import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { facilityCompliance, listDevices } from "@/lib/facility.ts";
import { expiringLicences, listUsers } from "@/lib/users.ts";
import { can } from "@/lib/access.ts";
import { verifyAuditChain } from "@/lib/db.ts";
import { claimsSummary } from "@/lib/claims.ts";
import { formatKes, etimsBacklog, facilityLeakage } from "@/lib/billing.ts";
import { coverage as terminologyCoverage } from "@/lib/terminology.ts";
import { queue } from "@/lib/frontdesk.ts";
import { bedBoard } from "@/lib/inpatient.ts";
import { unacknowledged, pendingOrders } from "@/lib/orders.ts";
import { worklist } from "@/lib/pharmacy.ts";
import { countOpen } from "@/lib/notifications.ts";
import { listStores, reorderReport } from "@/lib/inventory.ts";
import { outstandingInvoices } from "@/lib/billing.ts";
import { Shell, Stat, Section, Banner } from "@/app/_components/shell.tsx";

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

  const flags = facilityCompliance(user.facilityId);
  const expiring = expiringLicences(user.facilityId, 60);
  const staff = listUsers(user.facilityId);
  const devices = listDevices(user.facilityId);
  const chain = verifyAuditChain();
  const claims = claimsSummary();
  const etims = etimsBacklog();
  const catalogue = terminologyCoverage();
  const waiting = queue(user.facilityId);
  const alerts = countOpen(user.facilityId);
  const beds = bedBoard(user.facilityId);
  const results = unacknowledged();
  const labBench = pendingOrders("lab");
  const store = listStores(user.facilityId).find((s) => s.dispensing);
  const counter = store ? worklist(store.code) : [];
  const reorder = store ? reorderReport(store.code).order : [];
  const leakage = facilityLeakage(user.facilityId);
  const owed = outstandingInvoices(user.facilityId);

  const critical = flags.filter((f) => f.severity === "critical");
  const warnings = flags.filter((f) => f.severity === "warning");

  // A starter catalogue is a compliance fact, not a footnote: a clinician who
  // cannot find their diagnosis picks something close, and wrong codes are a
  // named rejection cause.
  if (catalogue.starterOnly) {
    warnings.push({
      key: "icd11_catalogue",
      severity: "warning",
      message: `Only ${catalogue.total} ICD-11 codes are loaded. Load the full WHO release before go-live.`,
    });
  }
  if (etims.queued > 0) {
    warnings.push({
      key: "etims_backlog",
      severity: "warning",
      message: `${etims.queued} invoice${etims.queued === 1 ? "" : "s"} not yet transmitted to eTIMS.`,
    });
  }

  return (
    <Shell
      user={user}
      current="/"
      title="Today"
      subtitle="Am I going to get paid, and am I going to pass an inspection."
      actions={
        <>
          <Link href="/queue" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
            Waiting list
          </Link>
          {can(user.userId, "patient.register") ? (
            <Link href="/patients/new" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
              Register a patient
            </Link>
          ) : null}
        </>
      }
    >
      {/* ---- the work in front of people right now ---- */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Waiting"
          value={waiting.length}
          note={`${waiting.filter((v) => v.priority === "emergency").length} emergency`}
          tone={waiting.some((v) => v.priority === "emergency") ? "block" : "ink"}
          href="/queue"
        />
        <Stat
          label="At the counter"
          value={counter.length}
          note={`${counter.filter((c) => c.short).length} short of stock`}
          tone={counter.some((c) => c.short) ? "clock" : "ink"}
          href="/pharmacy"
        />
        <Stat
          label="On the bench"
          value={labBench.length}
          note={`${labBench.filter((o) => o.priority === "stat").length} stat`}
          tone={labBench.some((o) => o.priority === "stat") ? "block" : "ink"}
          href="/laboratory"
        />
        <Stat
          label="Results unread"
          value={results.length}
          note={`${results.filter((r) => r.panic).length} critical`}
          tone={results.some((r) => r.panic) ? "block" : results.length > 0 ? "clock" : "good"}
          href="/laboratory"
        />
        <Stat
          label="Beds occupied"
          value={beds.filter((b) => b.occupied).length}
          note={`of ${beds.filter((b) => !b.bed.out_of_service).length} usable`}
          href="/ward"
        />
        <Stat
          label="Alerts"
          value={alerts.total}
          note={`${alerts.critical} critical`}
          tone={alerts.critical > 0 ? "block" : alerts.total > 0 ? "clock" : "good"}
          href="/notifications"
        />
      </div>

      {/* ---- blocking items: these stop the facility being paid ---- */}
      <Section title="Blocking">
        {critical.length === 0 ? (
          <Banner tone="good">Nothing is blocking claims or invoicing.</Banner>
        ) : (
          <ul className="flex flex-col gap-2">
            {critical.map((f) => (
              <li key={f.key}>
                <Banner tone="block">
                  {f.message}{" "}
                  {can(user.userId, "facility.configure") ? (
                    <Link href="/admin" className="underline underline-offset-2">
                      Fix it in administration.
                    </Link>
                  ) : null}
                </Banner>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ---- things that will start blocking if ignored ---- */}
      {warnings.length > 0 || expiring.length > 0 ? (
        <Section
          title="Expiring"
          note="A lapsed licence switches off prescribing, diagnosis and discharge for that person, because claims citing one are rejected."
        >
          <ul className="flex flex-col gap-2">
            {warnings.map((f) => (
              <li key={f.key}>
                <Banner tone="clock">{f.message}</Banner>
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
                  {l.days_left < 0 ? `expired ${Math.abs(l.days_left)} days ago` : `${l.days_left} days left`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* ---- the money view, which is why a facility buys this ---------- */}
      <Section title="Money">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat
            label="Claim acceptance"
            value={claims.acceptanceRatePercent === null ? "—" : `${claims.acceptanceRatePercent}%`}
            tone={
              claims.acceptanceRatePercent === null
                ? "muted"
                : claims.acceptanceRatePercent >= 90
                  ? "good"
                  : claims.acceptanceRatePercent >= 80
                    ? "clock"
                    : "block"
            }
            note={`${claims.total} claims`}
            href="/claims"
          />
          <Stat
            label="Value at risk"
            value={formatKes(claims.valueAtRiskCents)}
            tone={claims.overdue.length > 0 ? "block" : "ink"}
            note={claims.overdue.length > 0 ? `${claims.overdue.length} past the window` : "none overdue"}
            href="/claims"
          />
          <Stat
            label="Revenue leakage"
            value={formatKes(leakage.totalCents)}
            tone={leakage.totalCents > 0 ? "clock" : "good"}
            note={`${leakage.encounters} encounters with gaps`}
            href="/reports"
          />
          <Stat
            label="Owed to the facility"
            value={formatKes(owed.reduce((sum, o) => sum + o.balanceCents, 0))}
            tone={owed.some((o) => o.ageDays > 90) ? "block" : owed.length > 0 ? "clock" : "good"}
            note={`${owed.filter((o) => !o.payerOwes).length} at the desk, ${owed.filter((o) => o.payerOwes).length} with payers`}
            href="/payments"
          />
        </div>
      </Section>

      {/* ---- the evidence an inspector asks for ---- */}
      <Section title="Evidence">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Staff accounts"
            value={staff.filter((s) => s.active).length}
            note={`${staff.length} total, no shared logins`}
          />
          <Stat
            label="Registered devices"
            value={devices.filter((d) => !d.revoked_at).length}
            note={`${devices.filter((d) => d.revoked_at).length} revoked`}
          />
          <Stat
            label="Audit chain"
            value={chain.ok ? "Intact" : "Broken"}
            tone={chain.ok ? "good" : "block"}
            note={chain.ok ? `${chain.checked} entries verified` : `breaks at entry #${chain.failedAtId}`}
          />
        </div>
      </Section>
    </Shell>
  );
}

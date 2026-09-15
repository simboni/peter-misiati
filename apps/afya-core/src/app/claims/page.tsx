import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { check, explain } from "@/lib/access.ts";
import { claimsSummary, scrub, getClaim } from "@/lib/claims.ts";
import { Shell, Banner, Section, Empty, Views } from "@/app/_components/shell.tsx";
import { preauthWorklist } from "@/lib/payers.ts";
import { formatKes, etimsBacklog } from "@/lib/billing.ts";
import { pendingVerifications } from "@/lib/payers.ts";
import { resolvePatient } from "@/lib/patients.ts";

/**
 * The claims dashboard.
 *
 * Acceptance rate leads because it is the only number a facility owner actually
 * watches, and the one no incumbent publishes. Everything else on this page
 * exists to explain that number or to stop it falling.
 */
export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; error?: string }>;
}) {
  const { view = "claims", error } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const decision = check(user.userId, "report.read");
  if (!decision.allowed) {
    return (
      <Shell user={user} current="/claims" title="Claims">
        <div className="mt-5">
          <Banner tone="block">{explain(decision)}</Banner>
        </div>
      </Shell>
    );
  }

  const s = claimsSummary();
  const preauths = preauthWorklist();
  const etims = etimsBacklog();
  const unverified = pendingVerifications();

  return (
    <Shell
      user={user}
      current={view === "preauth" ? "/claims?view=preauth" : "/claims"}
      error={error}
      title={view === "preauth" ? "Pre-authorisations" : "Claims"}
      subtitle="Every gate maps to a documented reason SHA rejects a claim."
    >

      <Views
        current={view}
        views={[
          { key: "claims", label: "Claims", href: "/claims" },
          { key: "preauth", label: "Pre-authorisations", href: "/claims?view=preauth" },
        ]}
      />

      {view === "preauth" ? (
        <Section
          title="Pre-authorisation worklist"
          note="Waiting longest first. A claim citing an approval that never came back is an automatic rejection."
        >
          {preauths.length === 0 ? (
            <Empty>Nothing has been requested.</Empty>
          ) : (
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">Requested</th>
                  <th className="px-3 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 font-medium">Payer</th>
                  <th className="px-3 py-2 font-medium">Services</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium text-right">Valid to</th>
                </tr>
              </thead>
              <tbody>
                {preauths.map((a) => (
                  <tr key={a.id} className="border-t border-line align-top">
                    <td className="px-3 py-2 tnum text-muted whitespace-nowrap">
                      {(a.requested_at ?? a.created_at).slice(0, 10)}
                      {a.status === "requested" && a.daysWaiting > 0 ? (
                        <div className={`text-xs ${a.daysWaiting > 2 ? "text-block" : "text-clock"}`}>
                          {a.daysWaiting}d waiting
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{a.patient_name}</td>
                    <td className="px-3 py-2 text-muted">{a.payer_code}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {(JSON.parse(a.service_codes) as string[]).join(", ")}
                    </td>
                    <td
                      className={`px-3 py-2 font-medium ${
                        a.status === "approved"
                          ? "text-good"
                          : a.status === "declined" || a.status === "expired"
                            ? "text-block"
                            : "text-clock"
                      }`}
                    >
                      {a.status}
                      {a.decline_reason ? (
                        <div className="text-xs text-muted font-normal">{a.decline_reason}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tnum">{a.reference ?? "—"}</td>
                    <td className="px-3 py-2 text-right tnum text-muted">{a.valid_until ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted mt-3 leading-relaxed">
            An approval is only usable with the payer&apos;s own reference on it — a claim citing an approval
            without one is rejected, so the system refuses to record an approval that has no reference.
          </p>
        </Section>
      ) : (
      <>
      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="bg-white border border-line rounded px-4 py-3">
          <div className="text-xs text-muted">Acceptance rate</div>
          <div className={`text-3xl font-bold tnum mt-0.5 ${
            s.acceptanceRatePercent === null ? "text-muted"
              : s.acceptanceRatePercent >= 90 ? "text-good"
              : s.acceptanceRatePercent >= 80 ? "text-clock" : "text-block"
          }`}>
            {s.acceptanceRatePercent === null ? "—" : `${s.acceptanceRatePercent}%`}
          </div>
          <div className="text-xs text-muted mt-0.5 tnum">
            {s.acceptanceRatePercent === null
              ? "no decided claims yet"
              : `${s.accepted + s.paid} of ${s.accepted + s.paid + s.rejected} decided`}
          </div>
        </div>
        <div className="bg-white border border-line rounded px-4 py-3">
          <div className="text-xs text-muted">Value at risk</div>
          <div className="text-3xl font-bold tnum mt-0.5">{formatKes(s.valueAtRiskCents)}</div>
          <div className="text-xs text-muted mt-0.5 tnum">{s.draft + s.submitted} claims not yet paid</div>
        </div>
        <div className="bg-white border border-line rounded px-4 py-3">
          <div className="text-xs text-muted">eTIMS backlog</div>
          <div className={`text-3xl font-bold tnum mt-0.5 ${etims.queued > 0 ? "text-clock" : "text-good"}`}>
            {etims.queued}
          </div>
          <div className="text-xs text-muted mt-0.5">
            {etims.queued === 0 ? "all invoices transmitted" : "invoices awaiting KRA"}
          </div>
        </div>
      </section>

      {s.overdue.length > 0 ? (
        <section className="mt-7">
          <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-block">Past the window</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {s.overdue.map((c) => (
              <li key={c.id} className="bg-block-soft border border-block/25 rounded px-4 py-2.5 flex flex-wrap gap-x-3 text-sm">
                <span className="font-mono text-xs tnum">{c.id}</span>
                <span className="font-semibold text-block tnum">{c.daysLate} days late</span>
                <span className="ml-auto tnum">{formatKes(c.totalCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-7">
        <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">Closing soon</h2>
        {s.closingSoon.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing waiting to be submitted.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {s.closingSoon.map((c) => {
              const claim = getClaim(c.id)!;
              const verdict = scrub(c.id);
              const patient = resolvePatient(claim.patient_mrn);
              return (
                <li
                  key={c.id}
                  className={`border rounded px-4 py-2.5 ${
                    c.daysLeft <= 2 ? "bg-clock-soft border-clock/25" : "bg-white border-line"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                    <span className="font-mono text-xs tnum">{c.id}</span>
                    <span className="font-medium">
                      {patient ? `${patient.given_name} ${patient.family_name}` : claim.patient_mrn}
                    </span>
                    <span className={`text-xs font-semibold tnum ${c.daysLeft <= 2 ? "text-clock" : "text-muted"}`}>
                      {c.daysLeft} day{c.daysLeft === 1 ? "" : "s"} left
                    </span>
                    <span className="ml-auto tnum font-medium">{formatKes(c.totalCents)}</span>
                  </div>
                  <p className={`text-sm mt-0.5 ${verdict.ready ? "text-good" : "text-block"}`}>
                    {verdict.ready
                      ? "Ready to submit."
                      : verdict.blocking.map((g) => `${g.name}: ${g.message} (${g.owner})`).join(" · ")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {s.topRejectionReasons.length > 0 ? (
        <section className="mt-7">
          <h2 className="text-sm font-semibold tracking-[0.08em] uppercase text-muted">
            What rejections are costing
          </h2>
          <ul className="mt-2 flex flex-col gap-px bg-line border border-line rounded overflow-hidden">
            {s.topRejectionReasons.map((r) => (
              <li key={r.reason} className="bg-white px-4 py-2.5 flex flex-wrap gap-x-3 text-sm">
                <span>{r.reason}</span>
                <span className="text-muted tnum">×{r.count}</span>
                <span className="ml-auto tnum font-medium">{formatKes(r.valueCents)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted mt-2 leading-relaxed">
            Every reason here is a candidate for a new scrubber rule. That is how the rejection rate comes down
            instead of being absorbed.
          </p>
        </section>
      ) : null}

      {unverified.length > 0 ? (
        <p className="mt-7 text-sm bg-clock-soft border border-clock/25 text-clock rounded px-4 py-2.5">
          {unverified.length} member verification{unverified.length === 1 ? "" : "s"} still queued — the payer could
          not be reached. Claims for those patients will block until they resolve.
        </p>
      ) : null}
      </>
      )}
    </Shell>
  );
}

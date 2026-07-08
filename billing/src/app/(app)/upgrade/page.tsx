export const dynamic = "force-dynamic";
import { requireOrg, getOrg, getOrgProfile, countSeats } from "@/server/org";
import { getAdminContext } from "@/server/admin";
import { platformPricePerSeatKes } from "@/server/platform";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { requestUpgradeAction } from "@/server/actions/plan";
import { isPro, formatKes, PRO_FEATURES } from "@/lib/plan";
import Link from "next/link";

export const metadata = { title: "Upgrade" };

export default async function UpgradePage() {
  const { db, organizationId, user } = await requireOrg();
  const [org, profile, seats, perSeat, admin] = await Promise.all([
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
    countSeats(db, organizationId),
    platformPricePerSeatKes(db),
    getAdminContext(),
  ]);

  const pro = isPro(profile?.plan);
  const requested = Boolean(profile?.planRequestedAt);
  const unit = profile?.planPriceOverrideKes ?? perSeat;
  const price = Math.max(1, seats) * unit;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Plan & branding"
        subtitle="TallyPay is free to use. Upgrade to make it your own."
      />

      <section className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Current plan</p>
            <p className="mt-1 text-xl font-bold text-ink">{pro ? "Pro — white-label" : "Free"}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              pro ? "bg-brand-50 text-brand-700" : "bg-canvas text-muted"
            }`}
          >
            {pro ? "Active" : "TallyPay-branded"}
          </span>
        </div>
        {!pro && (
          <p className="mt-3 text-sm text-muted">
            Your documents currently carry a small <b className="text-ink">Powered by TallyPay</b>{" "}
            mark and use the default TallyPay look. Everything works — invoicing, M-Pesa, receipts —
            at no cost.
          </p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line bg-brand-50/60 p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">
                Pro — white-label
              </p>
              <p className="mt-2 text-3xl font-extrabold text-ink">
                {formatKes(unit)}
                <span className="text-base font-medium text-muted"> / user / month</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted">
                Your workspace: <b className="text-ink">{seats}</b> user{seats === 1 ? "" : "s"}
              </p>
              <p className="text-lg font-bold text-ink">
                {formatKes(price)} <span className="text-sm font-medium text-muted">/ month</span>
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Priced per user. Add teammates and the price scales with your team.
          </p>
        </div>

        <div className="p-6">
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-ink">
                <span className="mt-0.5 text-brand-600" aria-hidden>
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>

          <div className="mt-6">
            {pro ? (
              <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
                You’re on Pro — your documents are fully white-label. Customise your look in{" "}
                <a className="font-semibold underline" href="/settings">
                  Settings
                </a>
                .
              </p>
            ) : requested ? (
              <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
                <b>Request received.</b> We’ll reach out to <b>{user.email}</b> to activate Pro for{" "}
                <b>{org?.name}</b>. Thank you!
              </div>
            ) : (
              <form action={requestUpgradeAction}>
                <SubmitButton pendingText="Sending…">Upgrade to Pro →</SubmitButton>
                <p className="mt-2 text-xs text-muted">
                  We’ll confirm activation with you before anything is charged.
                </p>
              </form>
            )}
          </div>
        </div>
      </section>

      {admin && (
        <p className="text-sm text-muted">
          You’re a platform admin —{" "}
          <Link href={`/admin/vendors/${organizationId}`} className="font-semibold text-brand-700 underline">
            manage this workspace in the admin console
          </Link>
          .
        </p>
      )}
    </div>
  );
}

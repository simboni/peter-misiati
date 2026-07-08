export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/admin";
import { getVendorDetail } from "@/server/admin-queries";
import { countSeats } from "@/server/org";
import { platformPricePerSeatKes } from "@/server/platform";
import { formatMoney } from "@/server/money";
import { formatKes, isPro } from "@/lib/plan";
import { fmtDate } from "@/server/queries";
import { SubmitButton } from "@/components/submit-button";
import { PlanBadge } from "@/components/admin/ui";
import {
  setVendorPlanAction,
  setVendorSuspendedAction,
  setVendorPriceOverrideAction,
  saveVendorNoteAction,
} from "@/server/actions/admin";

export const metadata = { title: "Vendor · Admin" };

export default async function VendorDetail({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { db, isSuper } = await requireAdmin();
  const [detail, seats, perSeat] = await Promise.all([
    getVendorDetail(db, orgId),
    countSeats(db, orgId),
    platformPricePerSeatKes(db),
  ]);
  if (!detail) notFound();

  const { org, profile, members, recentInvoices, recentPayments } = detail;
  const pro = isPro(profile?.plan);
  const suspended = profile?.suspended ?? false;
  const unit = profile?.planPriceOverrideKes ?? perSeat;
  const monthly = Math.max(1, seats) * unit;

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/admin/vendors" className="text-sm text-muted hover:text-ink">
        ← All vendors
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{org.name}</h1>
          <p className="text-sm text-muted">
            {profile?.legalName || "—"} · joined {fmtDate(org.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PlanBadge plan={profile?.plan ?? "free"} suspended={suspended} />
        </div>
      </div>

      {/* Plan control */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Plan</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div>
            <p className="text-lg font-bold text-ink">{pro ? "Pro — white-label" : "Free"}</p>
            <p className="text-xs text-muted">
              {seats} seat{seats === 1 ? "" : "s"} · {formatKes(unit)}/user →{" "}
              <b className="text-ink">{formatKes(monthly)}/mo</b>
              {profile?.planRequestedAt && !pro ? " · upgrade requested" : ""}
              {profile?.planActivatedAt ? ` · active since ${fmtDate(profile.planActivatedAt)}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            {pro ? (
              <form action={setVendorPlanAction}>
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="plan" value="free" />
                <SubmitButton className="btn-ghost btn-sm">Revert to Free</SubmitButton>
              </form>
            ) : (
              <form action={setVendorPlanAction}>
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="plan" value="pro" />
                <SubmitButton className="btn-primary btn-sm">Activate Pro</SubmitButton>
              </form>
            )}
          </div>
        </div>

        {isSuper && (
          <form action={setVendorPriceOverrideAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <input type="hidden" name="orgId" value={orgId} />
            <div>
              <label className="label" htmlFor="price">
                Custom per-seat price (KES/mo) — blank uses default {formatKes(perSeat)}
              </label>
              <input
                id="price"
                name="price"
                className="input w-56"
                inputMode="numeric"
                placeholder={String(perSeat)}
                defaultValue={profile?.planPriceOverrideKes ?? ""}
              />
            </div>
            <SubmitButton className="btn-ghost btn-sm">Save price</SubmitButton>
          </form>
        )}
      </section>

      {/* Account state */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Account state</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {suspended
              ? "This workspace is suspended and cannot access the app."
              : "Active — the workspace can sign in and use Tally."}
          </p>
          <form action={setVendorSuspendedAction}>
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="suspended" value={suspended ? "false" : "true"} />
            <SubmitButton className={suspended ? "btn-primary btn-sm" : "btn-danger btn-sm"}>
              {suspended ? "Restore access" : "Suspend workspace"}
            </SubmitButton>
          </form>
        </div>
      </section>

      {/* Members */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Members ({members.length})
        </h2>
        <ul className="mt-3 divide-y divide-line">
          {members.map((m) => (
            <li key={m.memberId} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className="font-medium text-ink">{m.name}</span>{" "}
                <span className="text-muted">· {m.email}</span>
              </span>
              <span className="flex items-center gap-2">
                {(m.isSuper || m.isAdmin) && (
                  <span className="badge bg-slate-800 text-white">{m.isSuper ? "super admin" : "admin"}</span>
                )}
                <span className="badge bg-slate-100 text-slate-600">{m.role}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Recent activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent invoices</h2>
          <ul className="mt-3 divide-y divide-line">
            {recentInvoices.length === 0 && <li className="py-2 text-sm text-muted">None yet.</li>}
            {recentInvoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-ink">
                  {i.number} <span className="font-normal text-muted">· {i.status}</span>
                </span>
                <span className="tabular-nums">{formatMoney(i.total, i.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent payments</h2>
          <ul className="mt-3 divide-y divide-line">
            {recentPayments.length === 0 && <li className="py-2 text-sm text-muted">None yet.</li>}
            {recentPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-ink">
                  {p.number} <span className="font-normal text-muted">· {p.method}</span>
                </span>
                <span className="tabular-nums">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Internal note */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Internal note</h2>
        <form action={saveVendorNoteAction} className="mt-3 space-y-2">
          <input type="hidden" name="orgId" value={orgId} />
          <textarea
            name="note"
            rows={3}
            className="input"
            placeholder="Notes visible only to admins…"
            defaultValue={profile?.adminNote ?? ""}
          />
          <SubmitButton className="btn-ghost btn-sm">Save note</SubmitButton>
        </form>
      </section>
    </div>
  );
}

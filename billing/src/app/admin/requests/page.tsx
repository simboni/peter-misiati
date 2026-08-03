export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { listUpgradeRequests } from "@/server/admin-queries";
import { platformPricePerSeatKes } from "@/server/platform";
import { formatKes } from "@/lib/plan";
import { fmtDate } from "@/server/queries";
import { SubmitButton } from "@/components/submit-button";
import { setVendorPlanAction } from "@/server/actions/admin";

export const metadata = { title: "Upgrade requests · Admin" };

export default async function AdminRequests() {
  const { db } = await requireAdmin();
  const [requests, perSeat] = await Promise.all([listUpgradeRequests(db), platformPricePerSeatKes(db)]);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Upgrade requests</h1>
        <p className="text-sm text-muted">
          Vendors who asked to go Pro. Activate to switch on white-label for their workspace.
        </p>
      </div>

      <div className="card divide-y divide-line">
        {requests.length === 0 && <p className="p-5 text-sm text-muted">No pending requests. 🎉</p>}
        {requests.map((r) => (
          <div key={r.orgId} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <Link href={`/admin/vendors/${r.orgId}`} className="font-semibold text-ink hover:text-brand-700">
                {r.name}
              </Link>
              <p className="text-xs text-muted">
                {r.seats} seat{r.seats === 1 ? "" : "s"} · {formatKes(r.seats * perSeat)}/mo · requested{" "}
                {fmtDate(r.requestedAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <Link href={`/admin/vendors/${r.orgId}`} className="btn-ghost btn-sm">
                Review
              </Link>
              <form action={setVendorPlanAction}>
                <input type="hidden" name="orgId" value={r.orgId} />
                <input type="hidden" name="plan" value="pro" />
                <SubmitButton className="btn-primary btn-sm">Activate Pro</SubmitButton>
              </form>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

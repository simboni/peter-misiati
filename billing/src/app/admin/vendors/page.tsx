export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { listVendors } from "@/server/admin-queries";
import { formatMoney } from "@/server/money";
import { fmtDate } from "@/server/queries";
import { isPro } from "@/lib/plan";
import { PlanBadge } from "@/components/admin/ui";
import { SubmitButton } from "@/components/submit-button";
import { setVendorPlanAction } from "@/server/actions/admin";

export const metadata = { title: "Vendors · Admin" };

export default async function AdminVendors() {
  const { db } = await requireAdmin();
  const vendors = await listVendors(db);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Vendors</h1>
        <p className="text-sm text-muted">{vendors.length} workspace{vendors.length === 1 ? "" : "s"} on the platform.</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="th">Workspace</th>
              <th className="th">Plan</th>
              <th className="th text-right">Seats</th>
              <th className="th text-right">Invoices</th>
              <th className="th text-right">Invoiced</th>
              <th className="th text-right">Collected</th>
              <th className="th">Joined</th>
              <th className="th text-right">Manual upgrade</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.orgId} className="border-b border-line last:border-0 hover:bg-canvas">
                <td className="td">
                  <Link href={`/admin/vendors/${v.orgId}`} className="font-semibold text-ink hover:text-brand-700">
                    {v.name}
                  </Link>
                  <div className="text-xs text-muted">{v.ownerEmail ?? "—"}</div>
                </td>
                <td className="td">
                  <PlanBadge plan={v.plan} suspended={v.suspended} />
                  {v.requested && v.plan !== "pro" && (
                    <span className="ml-1 badge bg-amber-50 text-amber-700">requested</span>
                  )}
                </td>
                <td className="td text-right tabular-nums">{v.seats}</td>
                <td className="td text-right tabular-nums">{v.invoices}</td>
                <td className="td text-right tabular-nums">{formatMoney(v.gmv)}</td>
                <td className="td text-right tabular-nums">{formatMoney(v.collected)}</td>
                <td className="td text-xs text-muted">{fmtDate(v.createdAt)}</td>
                <td className="td text-right">
                  {isPro(v.plan) ? (
                    <form action={setVendorPlanAction} className="inline">
                      <input type="hidden" name="orgId" value={v.orgId} />
                      <input type="hidden" name="plan" value="free" />
                      <SubmitButton className="btn-ghost btn-sm">Revert to Free</SubmitButton>
                    </form>
                  ) : (
                    <form action={setVendorPlanAction} className="inline">
                      <input type="hidden" name="orgId" value={v.orgId} />
                      <input type="hidden" name="plan" value="pro" />
                      <SubmitButton className="btn-primary btn-sm">Activate Pro</SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {vendors.length === 0 && (
              <tr>
                <td className="td text-muted" colSpan={8}>
                  No vendors yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

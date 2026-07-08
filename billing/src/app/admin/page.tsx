export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { platformStats, listAudit, listUpgradeRequests } from "@/server/admin-queries";
import { platformKopokopoConfig, platformResendConfig } from "@/server/platform";
import { browserEnabled } from "@/server/config";
import { formatMoney } from "@/server/money";
import { formatKes } from "@/lib/plan";
import { fmtDate } from "@/server/queries";
import { Stat, HealthTile, SectionHead } from "@/components/admin/ui";

export const metadata = { title: "Overview · Admin" };

export default async function AdminOverview() {
  const { db } = await requireAdmin();
  const [stats, kopo, resend, browser, audit, requests] = await Promise.all([
    platformStats(db),
    platformKopokopoConfig(db),
    platformResendConfig(db),
    browserEnabled(),
    listAudit(db, 8),
    listUpgradeRequests(db),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ink">Platform overview</h1>
        <p className="text-sm text-muted">Everything across every workspace, at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vendors" value={String(stats.vendors)} sub={`${stats.signups30} new in 30 days`} />
        <Stat label="On Pro" value={String(stats.pro)} sub={`${stats.free} on free`} tone="brand" />
        <Stat label="MRR" value={formatKes(stats.mrrKes)} sub="recurring, per month" tone="brand" />
        <Stat
          label="Upgrade requests"
          value={String(stats.pendingRequests)}
          sub={stats.pendingRequests ? "awaiting action" : "all clear"}
          tone={stats.pendingRequests ? "warn" : "default"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Invoices" value={String(stats.invoices)} sub="platform-wide" />
        <Stat label="Invoiced (GMV)" value={formatMoney(stats.gmv)} />
        <Stat label="Collected" value={formatMoney(stats.collected)} sub="all payments recorded" />
        <Stat label="Suspended" value={String(stats.suspended)} tone={stats.suspended ? "warn" : "default"} />
      </div>

      <div>
        <SectionHead title="System health" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HealthTile ok={Boolean(kopo)} label="M-Pesa (Kopo Kopo)" hint="platform account for vendors without their own" />
          <HealthTile ok={Boolean(resend)} label="Email (Resend)" hint="send pay links to clients" />
          <HealthTile ok={browser} label="PDF export" hint="Cloudflare Browser Rendering" />
          <HealthTile ok label="Pricing" hint={`${formatKes(stats.pricePerSeatKes)} / user / mo`} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHead title="Pending upgrade requests" action={{ href: "/admin/requests", label: "All requests" }} />
          <div className="card divide-y divide-line">
            {requests.length === 0 && <p className="p-4 text-sm text-muted">No pending requests.</p>}
            {requests.slice(0, 5).map((r) => (
              <Link key={r.orgId} href={`/admin/vendors/${r.orgId}`} className="flex items-center justify-between p-3 hover:bg-canvas">
                <span className="text-sm font-medium text-ink">{r.name}</span>
                <span className="text-xs text-muted">{r.seats} seat{r.seats === 1 ? "" : "s"} · {fmtDate(r.requestedAt)}</span>
              </Link>
            ))}
          </div>
        </div>

        <div>
          <SectionHead title="Recent admin activity" action={{ href: "/admin/audit", label: "Full log" }} />
          <div className="card divide-y divide-line">
            {audit.length === 0 && <p className="p-4 text-sm text-muted">No activity yet.</p>}
            {audit.map((a) => (
              <div key={a.id} className="p-3">
                <p className="text-sm text-ink">
                  <span className="font-medium">{a.action}</span>
                  {a.targetLabel ? <span className="text-muted"> · {a.targetLabel}</span> : null}
                </p>
                <p className="text-xs text-muted">
                  {a.actorEmail} · {fmtDate(a.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

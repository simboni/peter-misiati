export const dynamic = "force-dynamic";
import { requireAdmin } from "@/server/admin";
import { listPaymentsFeed, listIntentsFeed } from "@/server/admin-queries";
import { formatMoney } from "@/server/money";
import { fmtDateTime } from "@/server/queries";
import { StatusPill } from "@/components/admin/ui";

export const metadata = { title: "Payments · Admin" };

export default async function AdminPayments() {
  const { db } = await requireAdmin();
  const [payments, intents] = await Promise.all([listPaymentsFeed(db, 80), listIntentsFeed(db, 80)]);
  const stuck = intents.filter((i) => i.status !== "success").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ink">Payments</h1>
        <p className="text-sm text-muted">
          Every payment recorded and every M-Pesa attempt, across all workspaces.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Recorded payments
        </h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Receipt</th>
                <th className="th">Workspace</th>
                <th className="th">Invoice</th>
                <th className="th">Method</th>
                <th className="th text-right">Amount</th>
                <th className="th">When</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="td font-medium text-ink">{p.number}</td>
                  <td className="td">{p.orgName ?? "—"}</td>
                  <td className="td text-muted">{p.invoiceNumber ?? "—"}</td>
                  <td className="td capitalize">{p.method}</td>
                  <td className="td text-right tabular-nums">{formatMoney(p.amount)}</td>
                  <td className="td text-xs text-muted">{fmtDateTime(p.paidAt)}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr><td className="td text-muted" colSpan={6}>No payments yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          M-Pesa attempts {stuck > 0 && <span className="badge bg-amber-50 text-amber-700">{stuck} not completed</span>}
        </h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Workspace</th>
                <th className="th">Invoice</th>
                <th className="th">Phone</th>
                <th className="th text-right">Amount</th>
                <th className="th">Status</th>
                <th className="th">When</th>
              </tr>
            </thead>
            <tbody>
              {intents.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0">
                  <td className="td">{i.orgName ?? "—"}</td>
                  <td className="td text-muted">{i.invoiceNumber ?? "—"}</td>
                  <td className="td tabular-nums">{i.phone}</td>
                  <td className="td text-right tabular-nums">{formatMoney(i.amount)}</td>
                  <td className="td">
                    <StatusPill status={i.status} />
                    {i.errorMessage && <div className="text-xs text-red-600">{i.errorMessage}</div>}
                  </td>
                  <td className="td text-xs text-muted">{fmtDateTime(i.createdAt)}</td>
                </tr>
              ))}
              {intents.length === 0 && (
                <tr><td className="td text-muted" colSpan={6}>No M-Pesa attempts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

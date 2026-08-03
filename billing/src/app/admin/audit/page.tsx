export const dynamic = "force-dynamic";
import { requireAdmin } from "@/server/admin";
import { listAudit } from "@/server/admin-queries";
import { fmtDateTime } from "@/server/queries";

export const metadata = { title: "Audit log · Admin" };

export default async function AdminAudit() {
  const { db } = await requireAdmin();
  const log = await listAudit(db, 200);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Audit log</h1>
        <p className="text-sm text-muted">Every admin action, newest first.</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="th">When</th>
              <th className="th">Admin</th>
              <th className="th">Action</th>
              <th className="th">Target</th>
              <th className="th">Detail</th>
            </tr>
          </thead>
          <tbody>
            {log.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="td whitespace-nowrap text-xs text-muted">{fmtDateTime(a.createdAt)}</td>
                <td className="td text-xs">{a.actorEmail}</td>
                <td className="td"><span className="badge bg-slate-100 text-slate-700">{a.action}</span></td>
                <td className="td text-muted">{a.targetLabel ?? a.targetType ?? "—"}</td>
                <td className="td text-muted">{a.detail ?? "—"}</td>
              </tr>
            ))}
            {log.length === 0 && (
              <tr><td className="td text-muted" colSpan={5}>No activity yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

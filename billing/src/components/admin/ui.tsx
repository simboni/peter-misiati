import Link from "next/link";

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "brand" | "warn";
}) {
  const valueColor = tone === "warn" ? "text-red-600" : tone === "brand" ? "text-brand-700" : "text-ink";
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 text-2xl font-extrabold tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function PlanBadge({ plan, suspended }: { plan: string; suspended?: boolean }) {
  if (suspended)
    return <span className="badge bg-red-50 text-red-700">Suspended</span>;
  return plan === "pro" ? (
    <span className="badge bg-brand-50 text-brand-700">Pro</span>
  ) : (
    <span className="badge bg-slate-100 text-slate-600">Free</span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-brand-50 text-brand-700",
    pending: "bg-amber-50 text-amber-700",
    failed: "bg-red-50 text-red-700",
    canceled: "bg-slate-100 text-slate-600",
  };
  return <span className={`badge ${map[status] ?? "bg-slate-100 text-slate-600"}`}>{status}</span>;
}

export function HealthTile({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className="card flex items-start gap-3 p-4">
      <span
        className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold ${
          ok ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-700"
        }`}
      >
        {ok ? "✓" : "!"}
      </span>
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="text-xs text-muted">{ok ? hint : `Not set up — ${hint}`}</p>
      </div>
    </div>
  );
}

export function SectionHead({ title, action }: { title: string; action?: { href: string; label: string } }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {action && (
        <Link href={action.href} className="text-sm font-medium text-brand-700 hover:underline">
          {action.label} →
        </Link>
      )}
    </div>
  );
}

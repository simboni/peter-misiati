const STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-blue-50 text-blue-700",
  partial: "bg-amber-50 text-amber-700",
  paid: "bg-brand-50 text-brand-700",
  overdue: "bg-red-50 text-red-700",
  void: "bg-slate-100 text-slate-400 line-through",
  accepted: "bg-brand-50 text-brand-700",
  declined: "bg-red-50 text-red-700",
  delivered: "bg-brand-50 text-brand-700",
};

const LABELS: Record<string, string> = {
  partial: "part-paid",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {LABELS[status] ?? status}
    </span>
  );
}

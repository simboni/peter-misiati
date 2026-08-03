import { Chip } from "@/components/ui";

export interface WeightRowView {
  observedOn: string;
  weightKg: number | null;
  bcs: number | null;
  method: string | null;
}

const METHOD_WORD: Record<string, string> = {
  SCALE: "scale",
  HEART_GIRTH: "tape",
  ESTIMATE: "estimate",
};

/**
 * The weight and condition history, newest first, with the growth rate between
 * consecutive weighings worked out — the form of the number that means
 * something to a farmer, unlike the raw kilos.
 */
export function WeightHistory({ rows }: { rows: WeightRowView[] }) {
  const ordered = [...rows].sort((a, b) => a.observedOn.localeCompare(b.observedOn));
  const weighed = ordered.filter((r) => r.weightKg != null);

  const gainOf = (r: WeightRowView): number | null => {
    const i = weighed.indexOf(r);
    if (i <= 0) return null;
    const prev = weighed[i - 1];
    const days =
      (Date.parse(`${r.observedOn}T00:00:00Z`) - Date.parse(`${prev.observedOn}T00:00:00Z`)) / 86_400_000;
    if (days <= 0) return null;
    return Math.round(((r.weightKg! - prev.weightKg!) * 1000) / days);
  };

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <thead className="text-left text-ink-3">
          <tr>
            <th className="pb-2 font-medium">Day</th>
            <th className="pb-2 font-medium">Weight</th>
            <th className="pb-2 font-medium">Growth</th>
            <th className="pb-2 font-medium">Condition</th>
            <th className="pb-2 font-medium">How</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {[...ordered].reverse().map((r, i) => {
            const gain = gainOf(r);
            return (
              <tr key={`${r.observedOn}-${i}`} className="border-t border-line">
                <td className="py-2">{r.observedOn}</td>
                <td className="py-2">{r.weightKg != null ? `${r.weightKg} kg` : "—"}</td>
                <td className="py-2">
                  {gain == null ? (
                    "—"
                  ) : (
                    <span className={gain < 0 ? "text-danger" : undefined}>
                      {gain > 0 ? "+" : ""}
                      {gain} g/day
                    </span>
                  )}
                </td>
                <td className="py-2">
                  {r.bcs != null ? (
                    <Chip tone={r.bcs < 2.5 ? "danger" : r.bcs > 4 ? "warn" : "ok"}>{r.bcs.toFixed(2)}</Chip>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 text-ink-3">{r.method ? METHOD_WORD[r.method] ?? r.method : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

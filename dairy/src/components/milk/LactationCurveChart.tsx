/**
 * The lactation curve. A server component — it renders SVG, so it costs the
 * phone nothing and works with JavaScript off.
 *
 * Shape carries the meaning here (R9): the peak is marked, and the line's slope
 * after it IS persistency. The numbers sit beside it for anyone who wants them.
 */
import type { LactationCurve } from "@/server/milk";

export function LactationCurveChart({ curve }: { curve: LactationCurve }) {
  const days = curve.days.filter((d) => d.dim !== null);
  if (days.length < 2) {
    return (
      <p className="text-sm text-ink-3">
        Two days of records draw the curve. There {days.length === 1 ? "is" : "are"} {days.length} so far.
      </p>
    );
  }

  const W = 640;
  const H = 220;
  const PAD = 28;
  const maxDim = Math.max(305, ...days.map((d) => d.dim!));
  const maxL = Math.max(...days.map((d) => d.litres)) * 1.15;

  const x = (dim: number) => PAD + (dim / maxDim) * (W - PAD * 2);
  const y = (l: number) => H - PAD - (l / maxL) * (H - PAD * 2);

  const path = days.map((d, i) => `${i === 0 ? "M" : "L"} ${x(d.dim!).toFixed(1)} ${y(d.litres).toFixed(1)}`).join(" ");
  const peak = days.reduce((best, d) => (d.litres > best.litres ? d : best), days[0]);

  return (
    <figure className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[320px]"
        role="img"
        aria-label={`Lactation curve for ${curve.name}: peak ${curve.peakDailyL} litres on day ${curve.daysToPeak}, ${curve.cumulativeL} litres so far.`}
      >
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--color-line)" strokeWidth="1" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--color-line)" strokeWidth="1" />

        {/* Day 305 — the standard basis for comparing lactations. */}
        {maxDim >= 305 ? (
          <>
            <line
              x1={x(305)} y1={PAD} x2={x(305)} y2={H - PAD}
              stroke="var(--color-line)" strokeDasharray="4 4"
            />
            <text x={x(305) - 4} y={PAD - 8} textAnchor="end" fontSize="11" fill="var(--color-ink-3)">
              day 305
            </text>
          </>
        ) : null}

        <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinejoin="round" />

        {days.map((d) => (
          <circle key={d.date} cx={x(d.dim!)} cy={y(d.litres)} r="3" fill="var(--color-brand)" />
        ))}

        <circle cx={x(peak.dim!)} cy={y(peak.litres)} r="6" fill="none" stroke="var(--color-brass)" strokeWidth="2" />
        <text
          x={x(peak.dim!)} y={y(peak.litres) - 12} textAnchor="middle" fontSize="12"
          fill="var(--color-brass)" fontWeight="600"
        >
          peak {peak.litres} L
        </text>

        <text x={PAD} y={H - 8} fontSize="11" fill="var(--color-ink-3)">day 0</text>
        <text x={W - PAD} y={H - 8} fontSize="11" fill="var(--color-ink-3)" textAnchor="end">
          day {maxDim}
        </text>
      </svg>
      <figcaption className="mt-1 text-sm text-ink-2">{curve.message}</figcaption>
    </figure>
  );
}

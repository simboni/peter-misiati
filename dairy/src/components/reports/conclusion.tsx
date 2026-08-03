/**
 * The shape every report on screen takes.
 *
 * Conclusion first, always. The sentence is set larger than any number on the
 * page, the actions come next, and the figures sit underneath for anyone who
 * wants to check the working. A report that opens with a table has already
 * failed the user this product is built for.
 */
import type { ReactNode } from "react";

export function ReportHeader({
  title,
  period,
  sentence,
  actions,
  tone = "brand",
}: {
  title: string;
  period?: string;
  sentence: string;
  actions: string[];
  tone?: "brand" | "warn" | "danger";
}) {
  const border = { brand: "border-brand", warn: "border-brass", danger: "border-danger" }[tone];
  return (
    <section className={`mb-5 rounded-lg border-l-4 ${border} border-y border-r border-line bg-surface p-4`}>
      <p className="text-xs uppercase tracking-wide text-ink-3">{title}</p>
      {period ? <p className="text-xs text-ink-3">{period}</p> : null}
      {/* The conclusion, larger than any figure on the page. */}
      <p className="mt-2 text-lg leading-snug font-medium text-balance">{sentence}</p>
      {actions.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {actions.map((a, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span aria-hidden className="text-brand">→</span>
              <span>{a}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A figure with the words that make it mean something. Never a bare number. */
export function Figure({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger";
}) {
  const colour = {
    neutral: "text-ink",
    ok: "text-ok",
    warn: "text-brass",
    danger: "text-danger",
  }[tone];
  return (
    <div>
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${colour}`}>{value}</p>
      {note ? <p className="mt-0.5 text-xs text-ink-2">{note}</p> : null}
    </div>
  );
}

/**
 * Wide content scrolls inside its own box. The page body never scrolls
 * sideways — on a phone in a milking shed that is how a table gets lost.
 */
export function ScrollBox({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4">{children}</div>;
}

export function Table({
  headers,
  rows,
  align = [],
}: {
  headers: string[];
  rows: ReactNode[][];
  align?: Array<"left" | "right">;
}) {
  return (
    <ScrollBox>
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
            {headers.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`py-2 pr-3 font-medium ${align[i] === "right" ? "text-right" : ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`py-2 pr-3 align-top ${align[j] === "right" ? "text-right tabular-nums" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBox>
  );
}

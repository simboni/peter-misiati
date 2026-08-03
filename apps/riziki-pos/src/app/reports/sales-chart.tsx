"use client";

/**
 * Six months of sales, drawn with divs.
 *
 * No chart library on purpose: this loads over Nairobi mobile data onto a cheap
 * Android phone, and a charting bundle would cost more than the whole rest of
 * the app. Six bars need six divs.
 *
 * Design notes:
 *  - the current month is the emphasised bar, because it is the one being lived
 *    through; earlier months are context and stay quiet;
 *  - only the last bar carries a value label — a number on every bar is a table
 *    pretending to be a picture;
 *  - the grid is a hairline, present enough to read heights against and no more;
 *  - "View as table" is not a nicety. A bar chart is unreadable to a screen
 *    reader and to anyone the colours fail, so the same figures are one tap away.
 */

import { useId, useState } from "react";
import { formatKes } from "@/lib/units";
import { TableWrap, Th, Td } from "@/components/ui";

export interface MonthPoint {
  ym: string;
  label: string;
  salesCents: number;
}

export function SalesChart({ data }: { data: MonthPoint[] }) {
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();

  const max = Math.max(1, ...data.map((d) => d.salesCents));
  const summary = data.map((d) => `${d.label} ${formatKes(d.salesCents)}`).join(", ");

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Sales per month · highest {formatKes(max)}
        </p>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-expanded={asTable}
          aria-controls={tableId}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold text-muted hover:bg-wash"
        >
          {asTable ? "View as chart" : "View as table"}
        </button>
      </div>

      {asTable ? (
        <div id={tableId}>
          <TableWrap>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th align="right">Sales</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={d.ym}>
                  <Td className={i === data.length - 1 ? "font-bold" : ""}>
                    {d.label} {d.ym.slice(0, 4)}
                    {i === data.length - 1 ? (
                      <span className="ml-1.5 text-xs font-normal text-muted">so far</span>
                    ) : null}
                  </Td>
                  <Td align="right">{formatKes(d.salesCents)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      ) : (
        <div id={tableId}>
          <div
            className="relative h-44 pt-6"
            role="img"
            aria-label={`Sales for the last ${data.length} months: ${summary}.`}
          >
            {/* Recessive grid — something to read heights against, nothing more. */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 top-6">
              {[0, 25, 50, 75, 100].map((p) => (
                <div
                  key={p}
                  className="absolute inset-x-0 border-t border-line/60"
                  style={{ bottom: `${p}%` }}
                />
              ))}
            </div>

            <div className="relative flex h-full items-end gap-1.5">
              {data.map((d, i) => {
                const current = i === data.length - 1;
                // A month with no sales still gets a sliver, so the gap reads as
                // "nothing sold" rather than "no data".
                const height = Math.max(1.5, (d.salesCents / max) * 100);
                return (
                  <div key={d.ym} className="relative flex h-full flex-1 items-end">
                    <div
                      className={`relative w-full rounded-t-md ${
                        current ? "bg-brand" : "bg-brand-soft"
                      }`}
                      style={{ height: `${height}%` }}
                    >
                      {current ? (
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-bold tnum text-ink">
                          {formatKes(d.salesCents)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div aria-hidden className="mt-1.5 flex gap-1.5">
            {data.map((d, i) => (
              <div
                key={d.ym}
                className={`flex-1 text-center text-[11px] ${
                  i === data.length - 1 ? "font-bold text-ink" : "text-muted"
                }`}
              >
                {d.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

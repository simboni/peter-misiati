"use client";

/**
 * The sizes a thing is also sold in, and what each one costs.
 *
 * Ungerol has a price per kilogram, and it has a 5 kg, a 10 kg and a 20 kg,
 * each cheaper per kilogram than the last. This is where those are set.
 *
 * Two design decisions worth recording:
 *
 * The owner types the size and the TOTAL price — "20 kg for 8,800" — because
 * that is the sentence said across the counter and the number written on a
 * quotation. The rate per kilogram is what the customer is really comparing,
 * so it is shown live underneath rather than typed: a rate that had to be
 * entered would be a second place for the same fact to be wrong.
 *
 * The saving against buying loose is shown too, and it is not decoration. A
 * bundle priced ABOVE the loose rate is almost always a typo, and without this
 * line nothing on the screen would say so — the owner would find out when a
 * customer worked it out at the counter.
 */

import { formatKes } from "@/lib/units";
import { inputClass } from "@/components/ui";

export interface BundleRow {
  /** Blank while being typed — these are text boxes, not numbers. */
  size: string;
  price: string;
  floor: string;
}

export function emptyBundle(): BundleRow {
  return { size: "", price: "", floor: "" };
}

export function BundleRows({
  rows,
  onRows,
  unit,
  unitPriceCents,
}: {
  rows: BundleRow[];
  onRows: (rows: BundleRow[]) => void;
  /** kg, L or pcs — what a size is counted in. */
  unit: string;
  /** The loose price per unit, to measure a bundle's saving against. Zero if unset. */
  unitPriceCents: number;
}) {
  const set = (i: number, patch: Partial<BundleRow>) =>
    onRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const sizeMilli = Math.round((Number(r.size) || 0) * 1000);
        const priceCents = Math.round((Number(r.price) || 0) * 100);
        const rate = sizeMilli > 0 ? Math.round((priceCents * 1000) / sizeMilli) : 0;
        const loose = unitPriceCents > 0 ? Math.round((unitPriceCents * sizeMilli) / 1000) : 0;
        const saving = loose > 0 ? loose - priceCents : 0;

        return (
          <div key={i} className="rounded-xl bg-wash p-2.5 ring-1 ring-inset ring-line">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1 min-w-[5.5rem]">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                  Size ({unit})
                </span>
                <Decimal
                  value={r.size}
                  onValue={(v) => set(i, { size: v })}
                  label={`Bundle ${i + 1} size in ${unit}`}
                  placeholder="20"
                />
              </label>
              <label className="flex-1 min-w-[6.5rem]">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                  Price for it
                </span>
                <Decimal
                  value={r.price}
                  onValue={(v) => set(i, { price: v })}
                  label={`Bundle ${i + 1} price`}
                  placeholder="8800"
                />
              </label>
              <label className="flex-1 min-w-[6.5rem]">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                  Never below
                </span>
                <Decimal
                  value={r.floor}
                  onValue={(v) => set(i, { floor: v })}
                  label={`Bundle ${i + 1} floor`}
                  placeholder="—"
                />
              </label>
              <button
                type="button"
                onClick={() => onRows(rows.filter((_, n) => n !== i))}
                className="min-h-11 shrink-0 rounded-lg px-2.5 text-xs font-bold text-bad hover:bg-bad-soft xl:min-h-9"
                aria-label={`Remove bundle ${i + 1}`}
              >
                Remove
              </button>
            </div>

            {/* What this works out at, and whether it is actually cheaper than
                buying the same weight loose. */}
            {sizeMilli > 0 && priceCents > 0 ? (
              <p className="mt-1.5 text-[11px] tnum">
                <span className="font-bold text-brand-dark">
                  {formatKes(rate)}/{unit}
                </span>
                {loose > 0 ? (
                  saving > 0 ? (
                    <span className="text-good">
                      {" · "}saves {formatKes(saving)} against {formatKes(loose)} loose
                    </span>
                  ) : saving < 0 ? (
                    <span className="font-bold text-bad">
                      {" · "}dearer than {formatKes(loose)} loose — is that meant?
                    </span>
                  ) : (
                    <span className="text-muted">{" · "}the same as buying it loose</span>
                  )
                ) : null}
              </p>
            ) : null}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => onRows([...rows, emptyBundle()])}
        className="flex min-h-11 w-full items-center justify-center rounded-xl border border-dashed border-line text-sm font-bold text-brand hover:bg-wash xl:min-h-10"
      >
        ＋ Add a bundle
      </button>

      {/* The form posts these as JSON: the rows are a list of a length nobody
          knows in advance, and a server action reading `bundle_size_3` back out
          of flat form fields is a parser waiting to disagree with the screen. */}
      <input type="hidden" name="bundles" value={JSON.stringify(rows)} />
    </div>
  );
}

/** Same reasoning as the price boxes: text, so a refused save loses nothing. */
function Decimal({
  value,
  onValue,
  label,
  placeholder,
}: {
  value: string;
  onValue: (v: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <input
      className={`${inputClass} tnum`}
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^\d*\.?\d*$/.test(raw)) return;
        onValue(raw);
      }}
    />
  );
}

"use client";

/**
 * The price sheet.
 *
 * Deliberately one long form and one Save. The morning check is a single pass
 * down a list — you go item by item, type the two or three that moved, and
 * press save once. Saving each row on its own would be six round trips and six
 * chances to be interrupted with half the shop repriced.
 *
 * Rows that have been typed into light up, and the button counts them, so
 * before committing anything the attendant can see exactly how many prices they
 * are about to change. That count is the whole safety story of a screen that
 * can move every price in the shop.
 */

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, inputClass } from "@/components/ui";
import { formatKes, fromCents } from "@/lib/units";
import { savePricesAction, type PriceFormState } from "./actions";

const EMPTY: PriceFormState = {};

export interface SheetRow {
  id: number;
  name: string;
  kind: string;
  /** 'unit' — every price on this row is per `unit`, not per container. */
  basis: "pack" | "unit";
  unit: string;
  retail_cents: number;
  wholesale_cents: number;
  floor_cents: number;
  changed_at: string | null;
  changed_by: string | null;
  days: number | null;
  stale: boolean;
}

export function PriceSheet({ rows, staleDays }: { rows: SheetRow[]; staleDays: number }) {
  const [state, action, pending] = useActionState(savePricesAction, EMPTY);

  // The typed values, keyed by "retail_12" / "wholesale_12". Only what differs
  // from the stored price counts as an edit.
  const [draft, setDraft] = useState<Record<string, string>>({});

  const original = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of rows) {
      m[`retail_${r.id}`] = String(fromCents(r.retail_cents));
      m[`wholesale_${r.id}`] = String(fromCents(r.wholesale_cents));
    }
    return m;
  }, [rows]);

  const valueOf = (key: string) => draft[key] ?? original[key] ?? "";

  const touched = useMemo(() => {
    const ids = new Set<number>();
    for (const r of rows) {
      if (
        valueOf(`retail_${r.id}`) !== original[`retail_${r.id}`] ||
        valueOf(`wholesale_${r.id}`) !== original[`wholesale_${r.id}`]
      ) {
        ids.add(r.id);
      }
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, rows, original]);

  if (state.ok) {
    return (
      <div className="space-y-3">
        <Alert tone="good">{state.ok}</Alert>
        {state.lines?.length ? (
          <ul className="rounded-2xl bg-white p-4 text-sm shadow-card ring-1 ring-ink/5">
            {state.lines.map((l) => (
              <li key={l} className="border-b border-line py-1.5 last:border-0 tnum">
                {l}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Link
            href="/sell"
            className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-brand px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-dark"
          >
            Open the till →
          </Link>
          <Link
            href="/prices"
            className="flex min-h-12 items-center justify-center rounded-full bg-white px-5 text-sm font-bold text-brand-dark ring-1 ring-inset ring-line hover:bg-wash"
          >
            Change another
          </Link>
        </div>
      </div>
    );
  }

  // Bottom padding so the last rows can scroll clear of the sticky bar: a
  // sticky control that permanently covers a row of a form is a control that
  // hides the thing you came to change.
  return (
    <form action={action} className="space-y-3 pb-24 lg:pb-20">
      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}

      {state.needsPin ? (
        <div className="rounded-2xl bg-warn-soft p-3.5 ring-1 ring-inset ring-warn/30">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-warn">
              Owner&rsquo;s PIN
            </span>
            <input
              className={inputClass}
              name="owner_pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Needed to go below a floor price"
            />
          </label>
        </div>
      ) : null}

      {/*
        A list that reflows, not a table.

        As a table this needed four columns and two number boxes, and on a 360px
        Android the wholesale column simply fell off the right-hand edge — the
        card clipped it, so there was not even a scrollbar to reach it with. The
        shop's own screenshot showed "WHOLESAL" cut in half.

        So each row is a flex line instead. On a phone the name takes the whole
        first line and the two prices share the second, each labelled because
        there is no header row up there to label them. From `sm` up it is one
        line again with the header doing that job.
      */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-ink/5">
        <div className="hidden border-b border-line bg-wash px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-muted sm:flex">
          <span className="flex-1">Item</span>
          <span className="w-40 lg:w-52">Last changed</span>
          <span className="w-24 text-right xl:w-28">Retail</span>
          <span className="ml-3 w-24 text-right xl:w-28">Wholesale</span>
        </div>

        <div className="divide-y divide-line">
          {rows.map((r) => {
            const on = touched.has(r.id);
            return (
              <div
                key={r.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:flex-nowrap sm:py-1.5 ${
                  on ? "bg-brand-soft/60" : "hover:bg-wash/50"
                }`}
              >
                <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                  <span className="block font-bold leading-tight">
                    {r.name}
                    {/* Said on the row, not in the header: the sheet mixes
                        chemicals priced by the kilogram with jerricans priced
                        whole, and a column heading cannot tell them apart. */}
                    {r.basis === "unit" ? (
                      <span className="ml-1.5 text-[11px] font-semibold text-brand">per {r.unit}</span>
                    ) : null}
                  </span>
                  <span className="text-[11px] text-muted">
                    {r.floor_cents > 0 ? `floor ${formatKes(r.floor_cents)}` : "no floor set"}
                    <span className="sm:hidden">
                      {" · "}
                      {r.days === null ? "never changed" : `${r.days}d ago`}
                    </span>
                  </span>
                </div>

                <div className="hidden w-40 text-[12px] sm:block lg:w-52">
                  {r.days === null ? (
                    <span className="text-muted">never changed</span>
                  ) : (
                    <span className={r.stale ? "font-bold text-warn" : "text-muted"}>
                      {r.days === 0 ? "today" : `${r.days} day${r.days === 1 ? "" : "s"} ago`}
                      {r.changed_by ? <span className="text-muted"> · {r.changed_by}</span> : null}
                    </span>
                  )}
                </div>

                {(["retail", "wholesale"] as const).map((field) => {
                  const key = `${field}_${r.id}`;
                  return (
                    <label
                      key={field}
                      className="min-w-0 flex-1 sm:w-24 sm:flex-none xl:w-28"
                    >
                      <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-muted sm:hidden">
                        {field}
                      </span>
                      <input
                        name={key}
                        value={valueOf(key)}
                        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`${r.name} ${field} price`}
                        // 44px on a phone, where this is typed with a thumb.
                        className={`min-h-11 w-full rounded-lg border px-2 text-right text-sm font-bold tnum sm:min-h-9 ${
                          valueOf(key) !== original[key]
                            ? "border-brand bg-white text-brand-deep"
                            : "border-line bg-white"
                        }`}
                      />
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/*
        Sticky only once there is something to save.

        The count is what you check before committing, so it has to follow you
        down a long list — but while it reads "No prices changed yet" it is
        floating over a row of the form saying nothing, and on a phone that row
        is the one you were about to type in. Idle it sits at the end like any
        other button; the moment a price is touched it lifts and follows.
      */}
      <div
        className={
          touched.size > 0
            ? "sticky bottom-20 z-10 rounded-full bg-wash/80 p-1 shadow-lift backdrop-blur lg:bottom-4"
            : "p-1"
        }
      >
        <Button type="submit" className="w-full text-base" disabled={pending || touched.size === 0}>
          {pending
            ? "Saving…"
            : touched.size === 0
              ? "No prices changed yet"
              : `Save ${touched.size} price${touched.size === 1 ? "" : "s"}`}
        </Button>
        {touched.size > 0 && !pending ? (
          <p className="mt-1.5 text-center text-[11px] text-muted">
            Prices older than {staleDays} days are flagged. Past sales keep the price they were
            sold at — nothing already invoiced changes.
          </p>
        ) : null}
      </div>
    </form>
  );
}

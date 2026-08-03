"use client";

/**
 * Delivery entry. A lorry usually drops several things at once, so the line
 * rows are added on the fly rather than fixed at three — and every row repeats
 * the same input names, which is what lets the action read them back in order
 * with `getAll`.
 */

import { useActionState, useState } from "react";
import { Button, Field, inputClass, Alert } from "@/components/ui";
import { formatKes } from "@/lib/units";
import { saveSupplierAction, recordPurchaseAction, type FormState } from "./actions";

const EMPTY: FormState = {};

export interface SupplierFields {
  id: number;
  name: string;
  phone: string;
  note: string;
}

export function SupplierForm({ supplier }: { supplier?: SupplierFields }) {
  const [state, action, pending] = useActionState(saveSupplierAction, EMPTY);

  return (
    <form action={action} className="space-y-3.5">
      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

      {supplier ? <input type="hidden" name="id" value={supplier.id} /> : null}

      <Field label="Supplier name">
        <input className={inputClass} name="name" defaultValue={supplier?.name} required autoComplete="off" />
      </Field>

      <Field label="Phone">
        <input
          className={inputClass}
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={supplier?.phone}
          placeholder="0720 000 001"
          autoComplete="off"
        />
      </Field>

      <Field label="What they supply" hint="A note for whoever has to reorder — Ungerol, Ufacid, C.D.E.">
        <input className={inputClass} name="note" defaultValue={supplier?.note} autoComplete="off" />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
      </Button>
    </form>
  );
}

export interface ItemChoice {
  id: number;
  name: string;
  kind: string;
  unit_label: string;
  cost_cents: number;
}

const KIND_GROUP: Record<string, string> = {
  bulk: "Drums & bags",
  packaging: "Packaging",
  pack: "Repacks",
  finished: "Finished goods",
};

export function PurchaseForm({
  suppliers,
  items,
}: {
  suppliers: Array<{ id: number; name: string }>;
  items: ItemChoice[];
}) {
  const [state, action, pending] = useActionState(recordPurchaseAction, EMPTY);
  const [rows, setRows] = useState([0, 1]);
  const [nextRow, setNextRow] = useState(2);

  const groups = Object.keys(KIND_GROUP).filter((k) => items.some((i) => i.kind === k));

  return (
    <form action={action} className="space-y-3.5">
      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier">
          <select className={inputClass} name="supplier_id" defaultValue="">
            <option value="">Not recorded</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Delivery note no.">
          <input className={inputClass} name="ref" placeholder="DN 4821" autoComplete="off" />
        </Field>
      </div>

      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={row} className="rounded-xl border border-line bg-wash p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                Line {i + 1}
              </span>
              {rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((r) => r !== row))}
                  className="text-[11px] font-bold text-bad"
                >
                  Remove
                </button>
              ) : null}
            </div>

            <select className={`${inputClass} mb-2`} name="item_id" defaultValue="">
              <option value="">Choose an item…</option>
              {groups.map((kind) => (
                <optgroup key={kind} label={KIND_GROUP[kind]}>
                  {items
                    .filter((it) => it.kind === kind)
                    .map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                        {it.cost_cents ? ` — last ${formatKes(it.cost_cents)}/${it.unit_label}` : ""}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Units">
                <input
                  className={inputClass}
                  name="units"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="3"
                  autoComplete="off"
                />
              </Field>
              <Field label="Line cost (KES)">
                <input
                  className={inputClass}
                  name="cost"
                  type="text"
                  inputMode="decimal"
                  placeholder="193800"
                  autoComplete="off"
                />
              </Field>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => {
          setRows([...rows, nextRow]);
          setNextRow(nextRow + 1);
        }}
        className="w-full rounded-xl border border-dashed border-line px-4 py-2.5 text-sm font-bold text-brand"
      >
        + Another item
      </button>

      <Field
        label="Transport (KES)"
        hint="Spread across the lines by value, so the landed cost of each drum is right."
      >
        <input
          className={inputClass}
          name="transport"
          type="text"
          inputMode="decimal"
          placeholder="0"
          defaultValue="0"
          autoComplete="off"
        />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Recording…" : "Record delivery"}
      </Button>

      <p className="text-xs text-muted">
        Recording a delivery adds the stock, files the supplier's prices and moves each item's
        average cost — all at once, or not at all.
      </p>
    </form>
  );
}

/** Item picker for the price-history panel; plain GET so the URL stays shareable. */
export function ItemPicker({
  items,
  selected,
}: {
  items: Array<{ id: number; name: string; deliveries: number }>;
  selected?: number;
}) {
  return (
    <form method="get" className="flex gap-2">
      <select className={inputClass} name="item" defaultValue={selected ? String(selected) : ""}>
        <option value="">Choose an item…</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name} ({i.deliveries})
          </option>
        ))}
      </select>
      <Button type="submit" variant="ghost">
        Show
      </Button>
    </form>
  );
}

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
    <form action={action} className="space-y-3">
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
  /** kg, L or pcs — what a quantity of it is counted in. */
  canonical_unit: string;
  /** The usual container, in milli. Pre-fills a delivery line; never binds it. */
  size_milli: number;
}

/**
 * One line of a delivery: what came, how many, how big each one was.
 *
 * The container size is asked for HERE rather than taken from the item, and
 * that is the whole point of this component. Ufacid comes in 250 kg drums and
 * in 200 kg drums; with only the item's single size to multiply by, three of
 * the smaller drums were booked as 750 kg and the shop's stock was 50 kg out
 * with nothing on any screen to say why. The item's usual size pre-fills the
 * box, so an ordinary delivery is still three keystrokes.
 *
 * The weight is spelled out under the row as it is typed, because that number —
 * not the number of drums — is what the ledger is about to be moved by, and it
 * is the one an owner can check against the delivery note in his hand.
 */
function PurchaseLine({ items, groups }: { items: ItemChoice[]; groups: string[] }) {
  const [itemId, setItemId] = useState("");
  const [units, setUnits] = useState("");
  const [size, setSize] = useState("");
  const [cost, setCost] = useState("");

  const chosen = items.find((i) => String(i.id) === itemId);
  const unit = chosen?.canonical_unit ?? "kg";
  // Typed, or the item's usual container. Blank posts nothing and the server
  // falls back the same way, so the two can never disagree.
  const each = Number(size) || (chosen ? chosen.size_milli / 1000 : 0);
  const count = Number(units) || 0;
  const arrived = each > 0 && count > 0 ? each * count : 0;
  const costCents = Math.round((Number(cost) || 0) * 100);
  const perUnit = arrived > 0 && costCents > 0 ? Math.round(costCents / arrived) : 0;

  return (
    <>
      <select
        className={`${inputClass} mb-2`}
        name="item_id"
        value={itemId}
        onChange={(e) => {
          setItemId(e.target.value);
          setSize(""); // back to the new item's usual container
        }}
      >
        <option value="">Choose an item…</option>
        {groups.map((kind) => (
          <optgroup key={kind} label={KIND_GROUP[kind]}>
            {items
              .filter((it) => it.kind === kind)
              .map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                  {it.cost_cents
                    ? ` — last ${formatKes(it.cost_cents)}/${it.canonical_unit}`
                    : ""}
                </option>
              ))}
          </optgroup>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-2">
        <Field label="How many">
          <input
            className={inputClass}
            name="units"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="3"
            autoComplete="off"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
          />
        </Field>
        <Field
          label={`Each holding (${unit})`}
          hint={chosen ? `Usually ${chosen.size_milli / 1000} ${unit}.` : "Set on the product."}
        >
          <input
            className={`${inputClass} tnum`}
            name="size"
            inputMode="decimal"
            autoComplete="off"
            placeholder={chosen ? String(chosen.size_milli / 1000) : ""}
            value={size}
            onChange={(e) => {
              const raw = e.target.value;
              if (!/^\d*\.?\d*$/.test(raw)) return;
              setSize(raw);
            }}
          />
        </Field>
      </div>

      <div className="mt-2">
        <Field label="Line cost (KES)">
          <input
            className={inputClass}
            name="cost"
            type="text"
            inputMode="decimal"
            placeholder="193800"
            autoComplete="off"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </Field>
      </div>

      {arrived > 0 ? (
        <p className="mt-1.5 text-[11px] tnum">
          <span className="font-bold text-brand-dark">
            {count} × {each} {unit} = {arrived.toLocaleString()} {unit}
          </span>
          {perUnit > 0 ? (
            <span className="text-muted">
              {" · "}
              {formatKes(perUnit)}/{unit} landed
            </span>
          ) : null}
        </p>
      ) : null}
    </>
  );
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
    <form action={action} className="space-y-3">
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

      {/* A lorry drops three or four things at once; on a laptop the lines sit
          side by side so the whole delivery is on screen while it is typed. */}
      <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
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
                  // A real button, and it was 17px tall. Padded to a thumb on a
                  // phone; the negative margin keeps the row's own height.
                  className="-my-2 inline-flex min-h-11 items-center px-2 py-2 text-[11px] font-bold text-bad sm:min-h-0 sm:py-0"
                >
                  Remove
                </button>
              ) : null}
            </div>

            <PurchaseLine items={items} groups={groups} />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => {
          setRows([...rows, nextRow]);
          setNextRow(nextRow + 1);
        }}
        className="min-h-11 w-full rounded-xl border border-dashed border-line px-4 text-sm font-bold text-brand xl:min-h-9"
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
        Recording a delivery adds the stock, files the supplier’s prices and moves each item’s
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
    <form method="get" className="flex max-w-xl gap-2">
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

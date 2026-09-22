"use client";

/**
 * Everything about one product, behind its row.
 *
 * This used to be four money boxes. Re-pricing was the only thing an owner
 * could do to a thing the shop sells, so a chemical entered under the wrong
 * name, or sold by the litre when the shop weighs it, or with its drum size
 * mistyped, stayed wrong — and the only way out was to hide the row and add a
 * second one, which splits its stock and its sales history in two. The
 * catalogue is being retyped from the shop's actual shelves, and that job needs
 * every field, not the price.
 *
 * So the row opens on the same form the "Add something" screen shows, seeded
 * with what is on the shelf now. Same field order, same words, same bundle
 * editor. Learning the add form teaches the edit form.
 *
 * A client component so a refusal can be answered where it happened. The rules
 * are real and worth keeping — a price outside its own band would refuse every
 * sale at the asking price, which reads as the till being broken — but they
 * have to be argued with next to the box, not from the top of a screen the
 * owner has scrolled well past. The boxes hold what was typed, the message
 * lands under them, and the row stays open with the figures still in it.
 */

import { useActionState, useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { formatQty } from "@/lib/units";
import { savePricingAction, type PricingState } from "./actions";
import { BundleRows, type BundleRow } from "./bundle-rows";

const EMPTY: PricingState = {};

/** The three things a quantity can be counted in. Nothing else is storable. */
const UNITS: Array<{ key: string; label: string }> = [
  { key: "kg", label: "weight — kilograms (kg)" },
  { key: "L", label: "volume — litres (L)" },
  { key: "pcs", label: "the piece (pcs)" },
];

export default function PriceForm({
  itemId,
  name,
  aliases,
  unit,
  container,
  containerLabel,
  isChemical,
  price,
  floor,
  ceiling,
  reorder,
  oversell,
  onHandMilli,
  costCents,
  bundles,
}: {
  itemId: number;
  name: string;
  /** Comma-separated other names. Empty for anything that is not a chemical. */
  aliases: string;
  /** kg, L or pcs, as it stands. */
  unit: string;
  /** What one container holds, counted in `unit`. */
  container: number;
  /** drum, bag, jerrican… */
  containerLabel: string;
  /** Whether this row is a substance — only those carry other names. */
  isChemical: boolean;
  price: number;
  floor: number;
  ceiling: number;
  reorder: number;
  /** How far past zero it may be sold, in the item's own unit. */
  oversell: number;
  /** What the ledger says is on the shelf, for the warning about relabelling. */
  onHandMilli: number;
  /**
   * The weighted-average cost of one unit, or null for somebody who may not
   * see cost. Null is not zero: zero means "it cost nothing", null means "not
   * yours to know", and the margin line is simply absent for the second.
   */
  costCents: number | null;
  /** The sizes this is also sold in, as they stand. */
  bundles: BundleRow[];
}) {
  const [state, action, pending] = useActionState(savePricingAction, EMPTY);

  // Seeded from the shelf, then owned here — which is the whole point: a
  // refused save must not take the typed figures down with it.
  const [nameText, setNameText] = useState(name);
  const [aliasText, setAliasText] = useState(aliases);
  const [unitKey, setUnitKey] = useState(unit);
  const [containerText, setContainerText] = useState(num(container));
  const [labelText, setLabelText] = useState(containerLabel);
  const [priceText, setPriceText] = useState(num(price));
  const [floorText, setFloorText] = useState(num(floor));
  const [ceilingText, setCeilingText] = useState(num(ceiling));
  const [reorderText, setReorderText] = useState(num(reorder));
  const [oversellText, setOversellText] = useState(num(oversell));
  const [bundleRows, setBundleRows] = useState<BundleRow[]>(bundles);

  // Changing the unit relabels what is already on the books rather than
  // converting it, and an owner who thinks otherwise would quietly halve or
  // double the value of his own store. Said out loud, and only when it is true.
  const relabelling = unitKey !== unit && onHandMilli !== 0;

  // Both of these follow the box above rather than the shelf: a label still
  // reading "per kg" while litres is selected is the form telling the owner the
  // opposite of what it is about to save.
  const perNow = weighedUnit(unitKey) ? `per ${unitKey}` : "each";
  const reorderNow = weighedUnit(unitKey)
    ? `When less than this many ${unitKey} are left.`
    : `When fewer than this many ${labelText || "container"}s are left.`;

  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="itemId" value={itemId} />

      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Name" hint="What the counter will see.">
          <Text name="name" label="Name" value={nameText} onValue={setNameText} />
        </Field>
        {isChemical ? (
          <Field label="Other names it's known by" hint="Comma separated. Helps search find it.">
            <Text name="aliases" label="Other names" value={aliasText} onValue={setAliasText} />
          </Field>
        ) : (
          // Only a substance carries other names, but the field still has to
          // post: without it the action would read an empty alias list and wipe
          // the ones a chemical already has.
          <input type="hidden" name="aliases" value={aliasText} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Field label="Sold by" hint="What the price is per.">
          <select
            className={inputClass}
            name="unit"
            aria-label="Sold by"
            value={unitKey}
            onChange={(e) => setUnitKey(e.target.value)}
          >
            {UNITS.map((u) => (
              <option key={u.key} value={u.key}>
                {u.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Container holds" hint={`What one ${labelText || "container"} holds.`}>
          <Money
            name="container"
            label="Container holds"
            value={containerText}
            onValue={setContainerText}
          />
        </Field>
        <Field label="Container is called" hint="drum, bag, jerrican…">
          <Text
            name="containerLabel"
            label="Container is called"
            value={labelText}
            onValue={setLabelText}
          />
        </Field>
        <Field label={`Price ${perNow}`} hint="What the shop asks.">
          <Money name="price" label={`Price ${perNow}`} value={priceText} onValue={setPriceText} />
        </Field>
      </div>

      {/*
        THE MARGIN, WHILE THE PRICE IS BEING TYPED.

        Pricing happened on one screen and the margin appeared on another, a
        day later, in a report — so the shop found out it was selling flakes
        under cost by reading a red figure in Reports, long after the sale. The
        arithmetic is trivial and the moment it matters is the moment somebody
        is typing a new price, so it belongs here, live.

        Absent, not zero, for anybody without permission to see cost.
      */}
      {costCents === null ? null : <MarginLine costCents={costCents} priceText={priceText} unit={unitKey} onPrice={setPriceText} />}

      {relabelling ? (
        <Alert tone="warn">
          There {onHandMilli === 1 ? "is" : "are"} {formatQty(Math.abs(onHandMilli), unit)} of{" "}
          {name} on the books. Changing the unit renames that quantity — it will read as{" "}
          {formatQty(Math.abs(onHandMilli), unitKey)} — it does not convert it. Right if this was
          entered under the wrong unit; wrong if you meant to change what it is measured in.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <Field label="Never below" hint="Under this needs your PIN. Blank for no floor.">
          <Money name="floor" label="Never below" value={floorText} onValue={setFloorText} />
        </Field>
        <Field label="Never beyond" hint="Over this needs your PIN. Blank for no ceiling.">
          <Money name="ceiling" label="Never beyond" value={ceilingText} onValue={setCeilingText} />
        </Field>
        <Field label="Warn me at" hint={reorderNow}>
          <Money name="reorder" label="Warn me at" value={reorderText} onValue={setReorderText} />
        </Field>
        {/*
          How far past empty this ONE thing may be sold.

          The shop's general rule, under Users & settings, covers everything and
          is what almost every product now runs on. This box is the exception
          for a single product, and it is only ever more generous than the
          general rule — never less, or a shop that had switched fetching on
          would find one product quietly refusing a customer for a reason nobody
          could see on this screen.
        */}
        <Field
          label="May be sold short by"
          hint={`Blank to use the shop's own rule under Users and settings. A number here is this one product's exception: ${unit === "pcs" ? "how many" : `how many ${unit}`} you can fetch from the shop next door and put back on the next delivery.`}
        >
          <Money
            name="oversell"
            label="May be sold short by"
            value={oversellText}
            onValue={setOversellText}
          />
        </Field>
      </div>

      {/*
        The sizes, under the price they are measured against.

        Folded away by default: most of the catalogue has no bundles, and an
        empty editor open on every row would make a hundred-row screen twice as
        long for nothing. Open already when there are some, because then it is
        the thing being looked for.
      */}
      <details open={bundleRows.length > 0}>
        <summary className="cursor-pointer text-[13px] font-bold text-brand-dark">
          Bundles{bundleRows.length ? ` (${bundleRows.length})` : ""} ▾
        </summary>
        <p className="mb-2 mt-1.5 text-[11px] leading-relaxed text-muted">
          Sizes sold whole, at a price of their own — a 20 kg for a round number
          rather than twenty times the price above. Stock comes off the same
          place either way; this is a price, not a second shelf.
        </p>
        <BundleRows
          rows={bundleRows}
          onRows={setBundleRows}
          unit={unitKey}
          unitPriceCents={Math.round((Number(priceText) || 0) * 100)}
        />
      </details>

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {/* Keyed on the save, so a second save says so again rather than
            leaving a tick from the first one standing. */}
        {!state.error && state.savedAt ? (
          <span key={state.savedAt} className="text-[12px] font-bold text-good">
            ✓ Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Whether a price on this unit is a price for a quantity of it.
 *
 * "per pcs" is not English and not what the counter says — a thing counted in
 * pieces is priced each.
 */
function weighedUnit(unit: string): boolean {
  return unit === "kg" || unit === "L";
}

/** A plain text box, controlled for the same reason the money boxes are. */
/**
 * What this price earns, and what it would take to earn a given margin.
 *
 * Margin on the SELLING price — (price − cost) / price — because that is the
 * number the trade quotes and the one the reports show. Marking up the cost by
 * 30% is a 23% margin, and a shop that mixes the two prices its whole
 * catalogue wrong.
 *
 * The three buttons are the working part. "Work some margins" is not a
 * calculation anybody wants to do forty times with a phone calculator: tap 20%
 * and the price box fills with the price that earns 20% on this cost, rounded
 * up to the nearest shilling — then it is still a price the owner can type over
 * before saving. Nothing here saves anything.
 */
function MarginLine({
  costCents,
  priceText,
  unit,
  onPrice,
}: {
  costCents: number;
  priceText: string;
  unit: string;
  onPrice: (v: string) => void;
}) {
  const priceCents = Math.round((Number(priceText.replace(/[^\d.]/g, "")) || 0) * 100);
  const marginPct = priceCents > 0 ? ((priceCents - costCents) / priceCents) * 100 : 0;
  const earns = priceCents - costCents;

  /** The price that earns this margin on this cost, to the shilling above. */
  const priceFor = (pct: number) => {
    if (costCents <= 0 || pct >= 100) return 0;
    return Math.ceil(costCents / (1 - pct / 100) / 100) * 100;
  };

  const tone =
    costCents <= 0 || priceCents <= 0
      ? "text-muted"
      : earns < 0
        ? "text-bad"
        : marginPct < 10
          ? "text-warn"
          : "text-good";

  return (
    <div className="rounded-xl bg-wash px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="text-muted">
          Costs <span className="font-semibold text-ink tnum">{money(costCents)}</span>/{unit}
          {costCents <= 0 ? " — no cost recorded yet" : ""}
        </span>
        {costCents > 0 && priceCents > 0 ? (
          <span className={`font-bold tnum ${tone}`}>
            {earns < 0 ? "Loses" : "Earns"} {money(Math.abs(earns))}/{unit} · {marginPct.toFixed(0)}%
            margin
          </span>
        ) : null}
      </div>

      {costCents > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">Price it at</span>
          {[15, 20, 25, 30, 40].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => onPrice(String(priceFor(pct) / 100))}
              className="rounded-lg border border-line bg-white px-2 py-1 text-[11px] font-bold text-ink hover:bg-brand-soft hover:text-brand"
            >
              {pct}% = {money(priceFor(pct))}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Shillings, no decimals — the way a price is said out loud here. */
function money(cents: number): string {
  return `KES ${Math.round(cents / 100).toLocaleString("en-KE")}`;
}

function Text({
  name,
  label,
  value,
  onValue,
}: {
  name: string;
  label: string;
  value: string;
  onValue: (v: string) => void;
}) {
  return (
    <input
      className={inputClass}
      name={name}
      autoComplete="off"
      aria-label={label}
      value={value}
      onChange={(e) => onValue(e.target.value)}
    />
  );
}

/**
 * A money box that keeps what was typed.
 *
 * `type="number"` is deliberately not used: on a refused save it would silently
 * drop anything the browser considered invalid, and this is the one form where
 * the point is that nothing typed goes missing.
 */
function Money({
  name,
  label,
  value,
  onValue,
}: {
  name: string;
  label: string;
  value: string;
  onValue: (v: string) => void;
}) {
  return (
    <input
      className={`${inputClass} tnum`}
      name={name}
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^\d*\.?\d*$/.test(raw)) return;
        onValue(raw);
      }}
    />
  );
}

/** Blank for nothing set, so an empty box reads as "no floor" and not "zero". */
function num(n: number): string {
  return n ? String(Number(n.toFixed(3))) : "";
}

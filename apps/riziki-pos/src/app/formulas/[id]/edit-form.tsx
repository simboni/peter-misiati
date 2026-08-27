"use client";

/**
 * The recipe editor, and the form for a recipe that does not exist yet.
 *
 * One component for both. A new recipe is the same ingredient list, the same
 * batch size and the same steps as an edited one — the only difference is that
 * it has a name to be given and no history to protect — and two forms would
 * have meant two places for "the same chemical twice" to be handled
 * differently.
 *
 * When editing, saving never overwrites anything: the server action inserts a
 * new version and flips the old one out of `is_current`. The form says so
 * plainly, because an owner who thinks he is correcting a typo needs to know a
 * sale billed yesterday will still cost what it cost.
 *
 * The price sits directly under the batch size, and that is the whole of the
 * pricing on this screen. A recipe already says how much it makes — "20 L" —
 * so asking again on a second step for the size to price was asking the same
 * question twice. One quantity, one price for it, above the ingredients.
 *
 * A recipe sold in more than one size still can be: the recipe's own page has a
 * sizes form for that. It is separate on purpose — editing a recipe writes a new
 * version, and changing what a 5 L costs is not a change to how it is mixed. See
 * `bundle-form.tsx`.
 */

import { useActionState, useState } from "react";
import { Card, Field, inputClass, Button, Alert } from "@/components/ui";
import { formatKes } from "@/lib/units";

export interface ChemicalOption {
  id: number;
  name: string;
  canonical_unit: string;
}

export interface EditRow {
  chemicalId: number;
  qty: string;
}

export type SaveState = { error?: string };

interface Line extends EditRow {
  key: number;
}

export function EditFormulaForm({
  action,
  formulaId,
  name: nameInitial = "",
  batchPrice: batchPriceInitial = "",
  chemicals,
  refLitres: refLitresInitial,
  steps,
  note,
  rows,
  cancelHref,
  everSold,
  isNew = false,
}: {
  action: (state: SaveState, formData: FormData) => Promise<SaveState>;
  formulaId: number;
  /** What the shop calls the product now. Empty for a recipe being invented. */
  name?: string;
  /** What a whole batch of it sells for, in shillings. Empty if never priced. */
  batchPrice?: string;
  chemicals: ChemicalOption[];
  refLitres: string;
  steps: string;
  note: string;
  rows: EditRow[];
  cancelHref: string;
  /** Whether anything was ever sold against the version being edited. */
  everSold: boolean;
  /** A recipe being invented rather than corrected: asks for a name, has no history. */
  isNew?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {} as SaveState);

  const [lines, setLines] = useState<Line[]>(rows.map((r, i) => ({ ...r, key: i })));
  const [nextKey, setNextKey] = useState(rows.length);

  const [name, setName] = useState(nameInitial);
  const [refLitres, setRefLitres] = useState(refLitresInitial);
  const [batchPrice, setBatchPrice] = useState(batchPriceInitial);
  const [complaint, setComplaint] = useState<string | null>(null);

  const unitOf = (chemicalId: number) =>
    chemicals.find((c) => c.id === chemicalId)?.canonical_unit ?? "kg";

  /* Checked here rather than by the browser, so a refusal can be said in the
     shop's own words next to the boxes that caused it. */
  function problem(): string | null {
    if (name.trim().length < 2) return "Give the product a name.";
    if (!(Number(refLitres) > 0)) return "Say how many litres the recipe makes.";
    if (!lines.some((l) => Number(l.qty) > 0)) {
      return "Give at least one ingredient a quantity above zero.";
    }
    return null;
  }

  /*
    Checked on the way out rather than left to the browser, for the same reason
    the boxes are controlled: a refused save has to come back with everything
    still typed into it.
  */
  function guard(e: React.FormEvent<HTMLFormElement>) {
    const wrong = problem();
    setComplaint(wrong);
    if (wrong) e.preventDefault();
  }

  // What a litre of it comes to, shown live. A mixed product has no loose rate
  // to measure a saving against — what a litre costs is the chemicals that went
  // into it, and that moves with every delivery — so the rate is all this can
  // honestly show, and it is still the number a customer argues about.
  const litres = Number(refLitres) || 0;
  const priceCents = Math.round((Number(batchPrice) || 0) * 100);
  const perLitre = litres > 0 && priceCents > 0 ? Math.round(priceCents / litres) : 0;

  function update(key: number, patch: Partial<EditRow>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { key: nextKey, chemicalId: chemicals[0]?.id ?? 0, qty: "" }]);
    setNextKey((k) => k + 1);
  }

  return (
    // A form is one of the few things that should still be capped on a big
    // monitor — a 1600px-wide ingredient row is harder to use, not denser.
    <form
      action={formAction}
      onSubmit={guard}
      className="space-y-2.5 xl:max-w-5xl xl:space-y-3 2xl:max-w-6xl"
    >
      {isNew ? null : <input type="hidden" name="formulaId" value={formulaId} />}

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {complaint ? <Alert tone="bad">{complaint}</Alert> : null}

      <Card className="space-y-3">
        {/* Shown on an edit too. A recipe used to be asked its name once, when
            it was invented, and never again — so a product spelled wrong on the
            board stayed wrong, and the only way out was a second recipe with the
            sales split across the two. Renaming forks no version: what a mix is
            called is not part of what went into it. */}
        <Field
          label="Product name"
          hint={
            isNew
              ? "What the shop calls it on the board — “Carwash Shampoo”."
              : "Correcting this renames the product everywhere. It does not start a new version."
          }
        >
          <input
            className={inputClass}
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={isNew}
            placeholder="e.g. Carwash Shampoo"
          />
        </Field>

        <Field
          label="Recipe makes (litres)"
          hint="The size the quantities below are written for. The counter scales from here."
        >
          <input
            className={inputClass}
            type="number"
            name="refLitres"
            value={refLitres}
            onChange={(e) => setRefLitres(e.target.value)}
            min="0.001"
            step="0.001"
            inputMode="decimal"
            required={!isNew}
          />
        </Field>

        {/* Under the quantity, because it is a price FOR that quantity. The
            counter charges this for a batch and takes the chemicals off the
            shelf in the amounts below, which appear on the receipt as amounts
            with no money against them. */}
        <Field
          label={litres > 0 ? `Price for ${refLitres} L` : "Price for a batch"}
          hint="What the shop charges for a whole batch of it. Leave empty if this one is only ever mixed to order."
        >
          <input
            className={`${inputClass} tnum`}
            name="batchPrice"
            inputMode="decimal"
            autoComplete="off"
            value={batchPrice}
            onChange={(e) => {
              const raw = e.target.value;
              if (!/^\d*\.?\d*$/.test(raw)) return;
              setBatchPrice(raw);
            }}
            placeholder="3200"
          />
        </Field>

        {perLitre > 0 ? (
          <p className="-mt-1 text-[12px] font-bold text-brand-dark tnum">
            {formatKes(perLitre)} per litre
          </p>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
          Ingredients
        </div>

        {/* A long recipe is a lot of scrolling on a laptop; once a row can be
            half the width and still hold a chemical name, run two abreast. */}
        <div className="grid gap-2.5 xl:grid-cols-2 xl:gap-x-3">
        {lines.map((line) => (
          <div key={line.key} className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Chemical</span>
              <select
                className={inputClass}
                name="chemicalId"
                value={line.chemicalId}
                onChange={(e) => update(line.key, { chemicalId: Number(e.target.value) })}
              >
                {chemicals.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="w-28">
              <span className="sr-only">Quantity</span>
              <div className="relative">
                <input
                  className={`${inputClass} pr-9`}
                  type="number"
                  name="qty"
                  value={line.qty}
                  onChange={(e) => update(line.key, { qty: e.target.value })}
                  min="0"
                  step="0.001"
                  inputMode="decimal"
                  placeholder="0"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted">
                  {unitOf(line.chemicalId)}
                </span>
              </div>
            </label>

            <Button
              type="button"
              variant="ghost"
              className="px-3"
              aria-label={`Remove ingredient ${lines.indexOf(line) + 1}`}
              onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
            >
              ✕
            </Button>
          </div>
        ))}
        </div>

        <Button type="button" variant="ghost" onClick={addLine} className="w-full">
          + Add ingredient
        </Button>
      </Card>

      <Card className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Field label="Mixing steps" hint="One step per line.">
          <textarea className={inputClass} name="steps" defaultValue={steps} rows={6} />
        </Field>

        <Field
          label="Note / open question"
          hint="Clear this once the question on the transcribed sheet is settled."
        >
          <textarea className={inputClass} name="note" defaultValue={note} rows={3} />
        </Field>
      </Card>

      <Alert tone="neutral">
        {isNew
          ? "Saved as version 1. Correcting it later rewrites it where it stands, until a customer has been charged for it — after that, an edit starts a new version and leaves the old one alone."
          : everSold
          ? "Saving creates a new version. The old one stays exactly as it is, because every sale already billed on it points at it."
          : "Nothing has been sold on this recipe yet, so saving corrects it where it stands — no new version and no history to keep. Once a customer is charged for it, editing will start a new version instead."}
      </Alert>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="flex-1">
          {pending
            ? "Saving…"
            : isNew
              ? "Save recipe"
              : everSold
                ? "Save as new version"
                : "Save corrections"}
        </Button>
        <a
          href={cancelHref}
          className="rounded-xl border border-line bg-white px-4 py-3 text-sm font-bold text-ink hover:bg-wash"
        >
          Cancel
        </a>
      </div>

    </form>
  );
}

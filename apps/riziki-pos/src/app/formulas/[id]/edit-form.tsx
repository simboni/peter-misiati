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
 * A NEW recipe comes in two steps: the recipe, then the sizes it is sold in.
 * The reason is the counter — a mixed product with no sizes set can only be
 * billed by adding up its chemicals, which is not how Carwash Shampoo is sold
 * across a counter, and the old single form put that editor on a screen you
 * only reached after the recipe was already saved. Both steps stay mounted and
 * hidden rather than unmounted, so stepping back to fix a quantity does not
 * empty the size rows, and one submit carries the lot.
 *
 * An existing recipe keeps its own separate sizes form: editing a recipe writes
 * a new version, and changing what a 5 L costs is not a change to how it is
 * mixed. See `bundle-form.tsx`.
 */

import { useActionState, useState } from "react";
import { Card, Field, inputClass, Button, Alert } from "@/components/ui";
import { Steps } from "@/components/steps";
import { BundleRows, type BundleRow } from "@/app/items/bundle-rows";

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

  // Only a new recipe walks through two steps; an edit is one screen as before.
  const [step, setStep] = useState(0);
  const [name, setName] = useState(nameInitial);
  const [refLitres, setRefLitres] = useState(refLitresInitial);
  const [bundleRows, setBundleRows] = useState<BundleRow[]>([]);
  const [complaint, setComplaint] = useState<string | null>(null);

  const unitOf = (chemicalId: number) =>
    chemicals.find((c) => c.id === chemicalId)?.canonical_unit ?? "kg";

  /*
    Checked here rather than by the browser: a `required` box on a hidden step
    cannot be focused, so the browser refuses the submit and shows nothing —
    the owner presses Save on step two and the screen simply does not move.
  */
  function problem(): string | null {
    if (name.trim().length < 2) return "Give the product a name.";
    if (!(Number(refLitres) > 0)) return "Say how many litres the recipe makes.";
    if (!lines.some((l) => Number(l.qty) > 0)) {
      return "Give at least one ingredient a quantity above zero.";
    }
    return null;
  }

  function forward() {
    const wrong = problem();
    setComplaint(wrong);
    if (!wrong) setStep(1);
  }

  const ingredientCount = lines.filter((l) => Number(l.qty) > 0).length;

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
    <form action={formAction} className="space-y-2.5 xl:max-w-5xl xl:space-y-3 2xl:max-w-6xl">
      {isNew ? null : <input type="hidden" name="formulaId" value={formulaId} />}

      {isNew ? (
        <Steps
          steps={[
            { label: "The recipe", hint: "What goes in it, and how" },
            { label: "Sizes", hint: "5 L, 20 L — optional" },
          ]}
          current={step}
          onGo={setStep}
        />
      ) : null}

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {complaint ? <Alert tone="bad">{complaint}</Alert> : null}

      <div hidden={isNew && step !== 0} className="space-y-2.5 xl:space-y-3">
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

      {isNew ? (
        <div className="flex gap-2">
          <Button type="button" onClick={forward} className="flex-1">
            Next: sizes →
          </Button>
          <a
            href={cancelHref}
            className="rounded-xl border border-line bg-white px-4 py-3 text-sm font-bold text-ink hover:bg-wash"
          >
            Cancel
          </a>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="submit" disabled={pending} className="flex-1">
            {pending ? "Saving…" : everSold ? "Save as new version" : "Save corrections"}
          </Button>
          <a
            href={cancelHref}
            className="rounded-xl border border-line bg-white px-4 py-3 text-sm font-bold text-ink hover:bg-wash"
          >
            Cancel
          </a>
        </div>
      )}
      </div>

      {/* ------------------------------------------------------- step two */}
      {isNew ? (
        <div hidden={step !== 1} className="space-y-2.5 xl:space-y-3">
          <Card className="space-y-3">
            <div className="rounded-xl bg-wash p-2.5 text-[12px] ring-1 ring-inset ring-line">
              <span className="font-bold text-ink">{name.trim() || "This product"}</span>
              <span className="text-muted">
                {" — mixed "}
                {Number(refLitres) > 0 ? `${refLitres} L` : "a batch"} at a time, out of{" "}
                {ingredientCount === 1 ? "one chemical" : `${ingredientCount} chemicals`}
              </span>
            </div>

            <p className="text-[12px] leading-relaxed text-muted">
              A size sold whole, at a price of its own. The counter charges this
              price; the chemicals come off the shelf in the amounts the recipe
              asks for, and appear on the receipt as amounts with no money
              against them. Leave it empty if this one is only ever mixed to
              order.
            </p>

            {/* A mixed product has no loose rate to measure a saving against —
                what a litre of it costs is the chemicals that went into it, and
                that moves with every delivery. The rate per litre is all this
                can honestly show. */}
            <BundleRows
              rows={bundleRows}
              onRows={setBundleRows}
              unit="L"
              unitPriceCents={0}
            />
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending} className="flex-1">
{pending ? "Saving…" : "Save recipe"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep(0)}>
              ← Back
            </Button>
          </div>
        </div>
      ) : null}

    </form>
  );
}

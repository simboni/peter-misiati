"use client";

/**
 * The recipe editor.
 *
 * Saving never overwrites anything: the server action inserts a new version and
 * flips the old one out of `is_current`. The form says so plainly, because an
 * owner who thinks he is correcting a typo needs to know a batch mixed
 * yesterday will still cost what it cost.
 */

import { useActionState, useState } from "react";
import { Card, Field, inputClass, Button, Alert } from "@/components/ui";

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
  chemicals,
  refLitres,
  steps,
  note,
  rows,
  cancelHref,
  everMixed,
}: {
  action: (state: SaveState, formData: FormData) => Promise<SaveState>;
  formulaId: number;
  chemicals: ChemicalOption[];
  refLitres: string;
  steps: string;
  note: string;
  rows: EditRow[];
  cancelHref: string;
  /** Whether any batch was mixed against the version being edited. */
  everMixed: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {} as SaveState);

  const [lines, setLines] = useState<Line[]>(rows.map((r, i) => ({ ...r, key: i })));
  const [nextKey, setNextKey] = useState(rows.length);

  const unitOf = (chemicalId: number) =>
    chemicals.find((c) => c.id === chemicalId)?.canonical_unit ?? "kg";

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
      <input type="hidden" name="formulaId" value={formulaId} />

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}

      <Card className="space-y-3">
        <Field
          label="Reference batch (litres)"
          hint="The size the quantities below are written for. The calculator scales from here."
        >
          <input
            className={inputClass}
            type="number"
            name="refLitres"
            defaultValue={refLitres}
            min="0.001"
            step="0.001"
            inputMode="decimal"
            required
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

      <Card className="grid gap-3 xl:grid-cols-2">
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
        {everMixed
          ? "Saving creates a new version. The old one stays exactly as it is, because every batch already mixed points at it."
          : "This recipe has not been mixed yet, so saving corrects it where it stands — no new version and no history to keep. Once a batch is mixed against it, editing will start a new version instead."}
      </Alert>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="flex-1">
          {pending ? "Saving…" : everMixed ? "Save as new version" : "Save corrections"}
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

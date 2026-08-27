"use client";

/**
 * Adding a chemical the shop did not have, in two steps.
 *
 * It used to be one tall form with the sizes bolted onto the bottom, and an
 * owner adding his first product filled in the name, the unit and the price,
 * saw a button, and pressed it. The 5 kg, 10 kg and 20 kg prices were below the
 * fold, so they were set later or not at all, and the counter offered nothing
 * but loose weight for a chemical the shop sells in drums.
 *
 * So: details first, sizes second, one save at the end. The sizes step is not
 * skippable-by-accident any more — it is a screen you have to walk through —
 * but it is skippable on purpose, because plenty of chemicals really are sold
 * loose only, and "Add it" is right there.
 *
 * Both steps stay mounted and hidden rather than unmounted, so stepping back to
 * fix the price does not empty the size rows, and one submit carries the lot.
 * Nothing here is `required`: the browser cannot focus a hidden invalid field,
 * so the check that a name and a price were given is done in `problem()` below,
 * where it can also say which step to go back to.
 */

import { useActionState, useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { Steps } from "@/components/steps";
import { SIZE_UNITS, formatKes } from "@/lib/units";
import { BundleRows, type BundleRow } from "./bundle-rows";

export type AddProductState = { error?: string };

const EMPTY: AddProductState = {};

export default function AddProductForm({
  action,
}: {
  action: (prev: AddProductState, formData: FormData) => Promise<AddProductState>;
}) {
  const [state, submit, pending] = useActionState(action, EMPTY);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [unit, setUnit] = useState<string>("kg");
  const [container, setContainer] = useState("");
  const [containerLabel, setContainerLabel] = useState("drum");
  const [price, setPrice] = useState("");
  const [floor, setFloor] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [rows, setRows] = useState<BundleRow[]>([]);
  const [complaint, setComplaint] = useState<string | null>(null);

  // What a size is counted in: the canonical unit behind "500 g" is kg.
  const canonical = SIZE_UNITS.find((u) => u.key === unit)?.canonical ?? "kg";
  const priceCents = Math.round((Number(price) || 0) * 100);

  function problem(): string | null {
    if (name.trim().length < 2) return "Give it a name.";
    if (!(Number(container) > 0)) return "Say what one container holds.";
    if (!(Number(price) > 0)) return "Give it a price per unit.";
    return null;
  }

  function forward() {
    const wrong = problem();
    setComplaint(wrong);
    if (!wrong) setStep(1);
  }

  return (
    <form action={submit} className="space-y-3">
      <Steps
        steps={[
          { label: "The chemical", hint: "Name, unit and price" },
          { label: "Sizes", hint: "5 kg, 20 kg — optional" },
        ]}
        current={step}
        onGo={setStep}
      />

      {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
      {complaint ? <Alert tone="bad">{complaint}</Alert> : null}

      {/* ------------------------------------------------------ step one */}
      <div hidden={step !== 0} className="space-y-3">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Name" hint="What the counter will see.">
            <input
              className={inputClass}
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Caustic Soda"
            />
          </Field>
          <Field label="Other names it's known by" hint="Comma separated. Helps search find it.">
            <input
              className={inputClass}
              name="aliases"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="soda ash, magadi"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Field label="Sold by" hint="The unit the price is per.">
            <select
              className={inputClass}
              name="unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {SIZE_UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Container holds" hint="What one drum or bag holds, in the unit above.">
            <input
              className={inputClass}
              type="number"
              name="container"
              value={container}
              onChange={(e) => setContainer(e.target.value)}
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="25"
            />
          </Field>
          <Field label="Container is called" hint="drum, bag, jerrican…">
            <input
              className={inputClass}
              name="containerLabel"
              value={containerLabel}
              onChange={(e) => setContainerLabel(e.target.value)}
            />
          </Field>
          <Field label="Price per unit" hint="What one kilogram, litre or piece sells for.">
            <input
              className={inputClass}
              type="number"
              name="price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="50"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2.5 lg:max-w-md">
          <Field label="Never below" hint="Under this needs your PIN.">
            <input
              className={inputClass}
              type="number"
              name="floor"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="40"
            />
          </Field>
          <Field label="Never beyond" hint="Over this needs your PIN.">
            <input
              className={inputClass}
              type="number"
              name="ceiling"
              value={ceiling}
              onChange={(e) => setCeiling(e.target.value)}
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="60"
            />
          </Field>
        </div>

        <Button type="button" onClick={forward} className="w-full sm:w-auto">
          Next: sizes →
        </Button>
      </div>

      {/* ------------------------------------------------------ step two */}
      <div hidden={step !== 1} className="space-y-3">
        <div className="rounded-xl bg-wash p-2.5 text-[12px] ring-1 ring-inset ring-line">
          <span className="font-bold text-ink">{name.trim() || "This chemical"}</span>
          {priceCents > 0 ? (
            <span className="text-muted">
              {" — "}
              {formatKes(priceCents)} per {canonical} loose
            </span>
          ) : null}
        </div>

        <p className="text-[12px] leading-relaxed text-muted">
          A size sold whole, at a price of its own — a 20 kg for a round number
          rather than twenty times the loose rate. The counter offers these
          alongside the loose price. Leave it empty if this one is only ever
          weighed out.
        </p>

        <BundleRows rows={rows} onRows={setRows} unit={canonical} unitPriceCents={priceCents} />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? "Adding…" : "Add it"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setStep(0)}>
            ← Back
          </Button>
        </div>
      </div>
    </form>
  );
}

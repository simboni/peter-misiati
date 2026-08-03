"use client";

/**
 * Health entry forms.
 *
 * Two things separate these from every other form in the app. Withdrawal
 * periods and drug doses are NEVER prefilled (R5) — a carried-over dose is a
 * clinical error waiting to happen. And the receipt is the product: what a
 * herdsman needs is one sentence telling him when he may sell her milk again.
 */

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/dal";
import { Button, Card, Chip, Field, HardBlock, Receipt, Select, SoftWarning, TextInput } from "@/components/ui";
import { KENYA_ROUTINES } from "@/lib/domain/health";

type Action<T> = (prev: unknown, formData: FormData) => Promise<ActionResult<T>>;

export interface AnimalOption {
  id: string;
  label: string;
  milking: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
  productType: string;
  milkWithdrawalDays: number | null;
  meatWithdrawalDays: number | null;
  notForLactating: boolean;
  labelSource: string | null;
}

function Submit({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Saving…" : children}
    </Button>
  );
}

function Warnings({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="space-y-2">
      {messages.map((m, i) => (
        <SoftWarning key={i} message={m} />
      ))}
    </div>
  );
}

const QUARTERS = [
  { code: "LF", label: "Left front" },
  { code: "RF", label: "Right front" },
  { code: "LH", label: "Left hind" },
  { code: "RH", label: "Right hind" },
];

/* ---------------------------------------------------------------- */
/* Observation — the herdsman's screen                               */
/* ---------------------------------------------------------------- */

export function ObservationForm({
  action,
  animals,
  today,
}: {
  action: Action<{ animalName: string }>;
  animals: AnimalOption[];
  today: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <Card className="space-y-4">
        <Field label="Which animal">
          <Select name="animalId" required>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="What do you see?"
          hint="Your own words. You do not need to name a disease — the manager will decide what it is."
        >
          <TextInput name="signs" placeholder="Not eating, swollen quarter, limping" required />
        </Field>
        <input type="hidden" name="occurredOn" value={today} />
        <Submit>Tell the manager</Submit>
      </Card>
      {state ? (
        state.ok ? (
          <Receipt title="Noted" lines={[state.message ?? ""]} refCode={state.refCode} />
        ) : (
          <Receipt title="Not saved" tone="danger" lines={[state.error]} />
        )
      ) : null}
    </form>
  );
}

/* ---------------------------------------------------------------- */
/* Treatment — where the block engages                               */
/* ---------------------------------------------------------------- */

export function TreatForm({
  action,
  animals,
  products,
  today,
}: {
  action: Action<{
    animalName: string;
    milkClearOn: string | null;
    receiptLines: string[];
    warnings: string[];
  }>;
  animals: AnimalOption[];
  products: ProductOption[];
  today: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [animalId, setAnimalId] = useState(animals[0]?.id ?? "");
  const [productId, setProductId] = useState(products[0]?.id ?? "");

  const animal = animals.find((a) => a.id === animalId);
  const product = products.find((p) => p.id === productId);

  // Said before the treatment is given, not after — which is the only time it
  // can still change what happens.
  const foresight: string[] = [];
  if (product && product.milkWithdrawalDays == null) {
    foresight.push(
      `No withdrawal period is on file for ${product.name}. Read it off the label first — without it the app cannot tell you when her milk is safe.`,
    );
  }
  if (product?.notForLactating && animal?.milking) {
    foresight.push(`${product.name} is not for a cow in milk, and ${animal.label} is milking.`);
  }

  return (
    <form action={formAction} className="space-y-4">
      <Card className="space-y-4">
        <Field label="Which animal">
          <Select name="animalId" value={animalId} onChange={(e) => setAnimalId(e.target.value)} required>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.milking ? " — milking" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Product"
          hint={
            product
              ? product.milkWithdrawalDays != null
                ? `Milk ${product.milkWithdrawalDays} days, meat ${product.meatWithdrawalDays ?? "?"} days — ${product.labelSource ?? "no label source on file"}.`
                : "No withdrawal period on file."
              : undefined
          }
        >
          <Select name="productId" value={productId} onChange={(e) => setProductId(e.target.value)} required>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        {foresight.length > 0 ? <Warnings messages={foresight} /> : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Dose" hint="Never carried over from last time.">
            <TextInput name="dose" placeholder="20 ml" autoComplete="off" />
          </Field>
          <Field label="Given on">
            <TextInput name="occurredOn" type="date" defaultValue={today} required />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Route">
            <Select name="route" defaultValue={product?.productType === "INTRAMAMMARY" ? "INTRAMAMMARY" : "IM"}>
              {["IM", "IV", "SC", "PO", "INTRAMAMMARY", "TOPICAL", "INTRAUTERINE"].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Days of treatment" hint="Withdrawal counts from the last dose.">
            <TextInput name="durationDays" type="number" inputMode="numeric" min="1" max="60" defaultValue={1} />
          </Field>
        </div>

        {product?.productType === "INTRAMAMMARY" ? (
          <fieldset>
            <legend className="mb-1 block text-sm font-medium text-ink">Quarters treated</legend>
            <div className="flex flex-wrap gap-3">
              {QUARTERS.map((q) => (
                <label key={q.code} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="quartersTreated" value={q.code} className="size-5" />
                  {q.label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <Submit>Record treatment</Submit>
      </Card>

      {state ? (
        state.ok ? (
          <div className="space-y-3">
            {state.data.milkClearOn ? (
              <HardBlock message={state.message ?? ""} />
            ) : (
              <SoftWarning message={state.message ?? ""} />
            )}
            <Receipt
              title={`Treatment recorded for ${state.data.animalName}`}
              tone={state.data.milkClearOn ? "warn" : "danger"}
              lines={state.data.receiptLines}
              refCode={state.refCode}
            />
            <Warnings messages={state.data.warnings} />
          </div>
        ) : (
          <Receipt title="Not saved" tone="danger" lines={[state.error]} />
        )
      ) : null}
    </form>
  );
}

/* ---------------------------------------------------------------- */
/* Routine batch — sixty cows, one action                            */
/* ---------------------------------------------------------------- */

const GROUPS = [
  { code: "ALL", label: "The whole herd" },
  { code: "LACTATING", label: "Milking cows" },
  { code: "DRY", label: "Dry cows" },
  { code: "HEIFERS", label: "Heifers" },
  { code: "CALVES", label: "Calves" },
  { code: "BULLS", label: "Bulls" },
];

export function BatchForm({
  action,
  products,
  today,
  batchId,
  herdSize,
}: {
  action: Action<{ animals: number; products: number; message: string; warnings: string[] }>;
  products: ProductOption[];
  today: string;
  batchId: string;
  herdSize: number;
}) {
  const [state, formAction] = useActionState(action, null);
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <form action={formAction} className="space-y-4">
      <Card className="space-y-4">
        <input type="hidden" name="batchId" value={batchId} />

        <Field label="Who" hint={`${herdSize} animals on the farm today.`}>
          <Select name="group" defaultValue="ALL">
            {GROUPS.map((g) => (
              <option key={g.code} value={g.code}>
                {g.label}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-ink">
            Products — tick more than one to give them in the same pass
          </legend>
          <div className="space-y-2">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-3 rounded-md border border-line p-3">
                <input
                  type="checkbox"
                  name="productIds"
                  value={p.id}
                  className="size-5"
                  onChange={(e) =>
                    setPicked((prev) =>
                      e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id),
                    )
                  }
                />
                <span className="flex-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-sm text-ink-3">{p.productType}</span>
                </span>
                {p.milkWithdrawalDays == null ? (
                  <Chip tone="danger">No period on file</Chip>
                ) : p.milkWithdrawalDays > 0 ? (
                  <Chip tone="warn">Milk {p.milkWithdrawalDays} d</Chip>
                ) : (
                  <Chip tone="ok">No milk withdrawal</Chip>
                )}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field label="What for">
            <Select name="routine" defaultValue="DIP">
              {KENYA_ROUTINES.map((r) => (
                <option key={r.routine} value={r.routine}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Done on">
            <TextInput name="occurredOn" type="date" defaultValue={today} required />
          </Field>
        </div>

        <input type="hidden" name="eventType" value="DIPPING" />
        <Field label="Dose or dilution">
          <TextInput name="dose" placeholder="1:500 spray" autoComplete="off" />
        </Field>

        <Submit>{picked.length > 1 ? `Give ${picked.length} products to the group` : "Give to the group"}</Submit>
      </Card>

      {state ? (
        state.ok ? (
          <div className="space-y-3">
            <Receipt
              title={`${state.data.animals} animals done in one go`}
              lines={[state.data.message]}
              refCode={state.refCode}
            />
            <Warnings messages={state.data.warnings} />
          </div>
        ) : (
          <Receipt title="Not saved" tone="danger" lines={[state.error]} />
        )
      ) : null}
    </form>
  );
}

/* ---------------------------------------------------------------- */
/* Vaccination — the two rules that must be hard                     */
/* ---------------------------------------------------------------- */

export function VaccinateForm({
  action,
  animals,
  products,
  today,
}: {
  action: Action<{ animalName: string; label: string; nextDueOn: string | null; warnings: string[] }>;
  animals: AnimalOption[];
  products: ProductOption[];
  today: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [routine, setRoutine] = useState("FMD");
  const rule = KENYA_ROUTINES.find((r) => r.routine === routine);

  return (
    <form action={formAction} className="space-y-4">
      <Card className="space-y-4">
        <Field label="Vaccination" hint={rule?.note}>
          <Select name="routine" value={routine} onChange={(e) => setRoutine(e.target.value)} required>
            {KENYA_ROUTINES.map((r) => (
              <option key={r.routine} value={r.routine}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>

        {rule?.onceInLifetime ? (
          <SoftWarning message={`${rule.label} is given once in a lifetime. The app will refuse a second dose.`} />
        ) : null}

        <Field label="Which animal">
          <Select name="animalId" required>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Product" hint="Optional — but it is what carries the withdrawal period.">
            <Select name="productId" defaultValue="">
              <option value="">Not recorded</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Given on">
            <TextInput name="occurredOn" type="date" defaultValue={today} required />
          </Field>
        </div>

        <Field label="Vial batch number" hint="The traceability record if the batch is ever recalled.">
          <TextInput name="batchNo" autoComplete="off" />
        </Field>

        <Submit>Record vaccination</Submit>
      </Card>

      {state ? (
        state.ok ? (
          <div className="space-y-3">
            <Receipt
              title={`${state.data.label} — ${state.data.animalName}`}
              lines={[
                state.message ?? "",
                state.data.nextDueOn ? `Next one due ${state.data.nextDueOn}.` : "She never needs it again.",
              ]}
              refCode={state.refCode}
            />
            <Warnings messages={state.data.warnings} />
          </div>
        ) : (
          // The one other place besides withdrawal where the app refuses: S19
          // in the wrong animal cannot be undone.
          <HardBlock message={state.error} />
        )
      ) : null}
    </form>
  );
}

/* ---------------------------------------------------------------- */
/* CMT                                                               */
/* ---------------------------------------------------------------- */

const CMT_SCORES = [
  { code: "N", label: "N — negative" },
  { code: "T", label: "T — trace" },
  { code: "1", label: "1 — weak positive" },
  { code: "2", label: "2 — positive" },
  { code: "3", label: "3 — strong positive" },
];

export function CmtForm({
  action,
  animals,
  today,
}: {
  action: Action<{ animalName: string; advice: string }>;
  animals: AnimalOption[];
  today: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <Card className="space-y-4">
        <Field label="Which cow">
          <Select name="animalId" required>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Score" hint="Three quarters in four Kenyan cows carry mastitis you cannot see. The paddle is how you find it.">
          <Select name="score" defaultValue="N" required>
            {CMT_SCORES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <input type="hidden" name="occurredOn" value={today} />
        <Submit>Save result</Submit>
      </Card>
      {state ? (
        state.ok ? (
          <Receipt
            title={state.data.animalName}
            tone={state.data.advice.includes("vet") ? "warn" : "ok"}
            lines={[state.data.advice]}
            refCode={state.refCode}
          />
        ) : (
          <Receipt title="Not saved" tone="danger" lines={[state.error]} />
        )
      ) : null}
    </form>
  );
}

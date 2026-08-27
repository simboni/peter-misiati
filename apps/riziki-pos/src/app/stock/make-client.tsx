"use client";

/**
 * Making a batch: the concentrate off the shelf, the dilution on.
 *
 * Two products work this way and the rest of the catalogue does not, so this
 * panel only lists what has actually been told what it is made from. An empty
 * list is the ordinary state of a shop that buys everything it sells, and says
 * so rather than showing an empty table.
 *
 * Both quantities are typed, seeded from the stored ratio. The ratio is what
 * the shop aims at; the jug is what it gets — a litre of perfume concentrate is
 * treated as a kilogram and is not exactly one — so the boxes have to be
 * arguable. What is typed is what the ledger believes, and the difference is
 * the stock take's to find.
 */

import { useActionState, useState } from "react";
import { Alert, Button, Card, Field, SectionLabel, Empty, inputClass } from "@/components/ui";
import { formatQty, formatDateTime } from "@/lib/units";
import type { MakeState } from "./actions";

const EMPTY: MakeState = {};

export interface MakeChoice {
  toItemId: number;
  toName: string;
  toUnit: string;
  fromName: string;
  fromUnit: string;
  /** The stored ratio, in each side's own unit. */
  inQty: number;
  outQty: number;
  /** What is on the shelf of the thing it is made from. */
  fromOnHandMilli: number;
  /** What is already on the shelf of the thing being made. */
  toOnHandMilli: number;
}

export interface MadeBatch {
  id: number;
  at: string;
  fromName: string;
  fromUnit: string;
  inMilli: number;
  toName: string;
  toUnit: string;
  outMilli: number;
  userName: string | null;
}

export function MakeClient({
  choices,
  recent,
  action,
}: {
  choices: MakeChoice[];
  recent: MadeBatch[];
  action: (state: MakeState, formData: FormData) => Promise<MakeState>;
}) {
  const [state, submit, pending] = useActionState(action, EMPTY);
  const [picked, setPicked] = useState(choices[0]?.toItemId ?? 0);

  const chosen = choices.find((c) => c.toItemId === picked);

  if (!choices.length) {
    return (
      <Card>
        <Empty>
          Nothing here is made out of anything else. If the shop dilutes a
          concentrate — perfume, hypochlorite — open that product on Products &
          prices and fill in “Made from something else”. It will appear here.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c.toItemId}
              type="button"
              onClick={() => setPicked(c.toItemId)}
              className={`min-h-11 rounded-xl px-3.5 text-sm font-bold ring-1 ring-inset transition-colors xl:min-h-10 ${
                c.toItemId === picked
                  ? "bg-brand-soft text-brand-dark ring-brand/40"
                  : "bg-white text-ink ring-line hover:bg-wash"
              }`}
            >
              {c.toName}
            </button>
          ))}
        </div>

        {/* Above the form, not below it. A batch that has just been made leaves
            the boxes holding the amounts it used, and the shelf now short of
            them — so the form's own "there is only 0 kg left" sits between the
            button and the answer. What happened has to read first. */}
        {state.error ? <Alert tone="bad">{state.error}</Alert> : null}
        {state.ok ? <Alert tone="good">{state.ok}</Alert> : null}

        {chosen ? <MakeForm key={chosen.toItemId} c={chosen} pending={pending} submit={submit} /> : null}
      </Card>

      {recent.length ? (
        <>
          <SectionLabel>Made recently</SectionLabel>
          <Card>
            <ul className="space-y-1 text-[12px]">
              {recent.map((b) => (
                <li key={b.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-bold text-ink">
                    {formatQty(b.outMilli, b.toUnit)} {b.toName}
                  </span>
                  <span className="text-muted">
                    from {formatQty(b.inMilli, b.fromUnit)} {b.fromName}
                  </span>
                  <span className="ml-auto text-muted tnum">
                    {formatDateTime(b.at)}
                    {b.userName ? ` · ${b.userName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function MakeForm({
  c,
  pending,
  submit,
}: {
  c: MakeChoice;
  pending: boolean;
  submit: (formData: FormData) => void;
}) {
  const [inQty, setInQty] = useState(String(c.inQty));
  const [outQty, setOutQty] = useState(String(c.outQty));

  const inMilli = Math.round((Number(inQty) || 0) * 1000);
  const outMilli = Math.round((Number(outQty) || 0) * 1000);
  const short = inMilli > c.fromOnHandMilli;

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="toItemId" value={c.toItemId} />

      <p className="text-[12px] leading-relaxed text-muted">
        Usually {c.inQty} {c.fromUnit} of {c.fromName} makes {c.outQty} {c.toUnit} of {c.toName}.
        Type what actually went in and what actually came out — the shelf follows
        the boxes, not the arithmetic.
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <Field
          label={`${c.fromName} used (${c.fromUnit})`}
          hint={`${formatQty(Math.max(0, c.fromOnHandMilli), c.fromUnit)} on the shelf.`}
        >
          <Decimal label="Used" name="inQty" value={inQty} onValue={setInQty} />
        </Field>
        <Field
          label={`${c.toName} made (${c.toUnit})`}
          hint={`${formatQty(Math.max(0, c.toOnHandMilli), c.toUnit)} there now.`}
        >
          <Decimal label="Made" name="outQty" value={outQty} onValue={setOutQty} />
        </Field>
      </div>

      {short ? (
        <Alert tone="bad">
          There is only {formatQty(Math.max(0, c.fromOnHandMilli), c.fromUnit)} of {c.fromName}{" "}
          left. Record the delivery first, or make a smaller batch.
        </Alert>
      ) : inMilli > 0 && outMilli > 0 ? (
        <p className="text-[12px] tnum">
          <span className="font-bold text-bad">
            − {formatQty(inMilli, c.fromUnit)} {c.fromName}
          </span>
          {"   "}
          <span className="font-bold text-good">
            + {formatQty(outMilli, c.toUnit)} {c.toName}
          </span>
        </p>
      ) : null}

      <Button type="submit" disabled={pending || short || inMilli <= 0 || outMilli <= 0}>
        {pending ? "Making…" : `Make ${outQty || "—"} ${c.toUnit}`}
      </Button>
    </form>
  );
}

/** Text, not `type=number`: a refused save must not silently empty a box. */
function Decimal({
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

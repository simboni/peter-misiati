"use client";

/**
 * "Where did the rest of the milk go?" One row per channel, including the ones
 * that earn nothing — home use, calves and the staff ration are valued at market
 * price so the owner can see what "free" milk costs.
 */

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/dal";
import type { DisposalResult } from "@/server/sales";
import { Button, Card, Field, HardBlock, Receipt, Select, SoftWarning, TextInput } from "@/components/ui";

type DisposalAction = (prev: unknown, formData: FormData) => Promise<ActionResult<DisposalResult>>;

const CHANNELS: Array<{ value: string; label: string; group: string }> = [
  { value: "COOP", label: "🏢 Co-operative", group: "Sold" },
  { value: "PROCESSOR", label: "🏭 Processor", group: "Sold" },
  { value: "INSTITUTION", label: "🏫 School or hotel", group: "Sold" },
  { value: "HOUSEHOLD", label: "🏠 Neighbour", group: "Sold" },
  { value: "SHOP", label: "🏪 Shop", group: "Sold" },
  { value: "MILK_ATM", label: "🚰 Milk ATM", group: "Sold" },
  { value: "HOME_CONSUMPTION", label: "🏡 Our own house", group: "Given" },
  { value: "CALF_FEEDING", label: "🍼 Calves", group: "Given" },
  { value: "STAFF_RATION", label: "👷 Staff milk", group: "Given" },
  { value: "SPOILAGE", label: "🗑️ Spoiled", group: "Lost" },
  { value: "REJECTED", label: "⛔ Rejected at reception", group: "Lost" },
  { value: "WITHHELD_TREATMENT", label: "💉 Withheld — treated cow", group: "Lost" },
  { value: "WITHHELD_COLOSTRUM", label: "🍼 Withheld — colostrum", group: "Lost" },
];

const LOSS_REASONS = [
  { value: "SPILLAGE", label: "Spilled" },
  { value: "SPOILAGE", label: "Went off before it left" },
  { value: "SOURED", label: "Soured" },
  { value: "ADULTERATION", label: "Rejected as adulterated" },
  { value: "NON_COLLECTION", label: "Nobody collected it" },
  { value: "FAILED_ALCOHOL", label: "Failed the alcohol test" },
  { value: "FAILED_LACTOMETER", label: "Failed the lactometer" },
  { value: "ORGANOLEPTIC", label: "Smelled or tasted wrong" },
  { value: "OTHER", label: "Something else" },
];

const LOSS_CHANNELS = new Set(["SPOILAGE", "REJECTED"]);

export function DisposalForm({
  date,
  customers,
  action,
}: {
  date: string;
  customers: Array<{ id: string; name: string; customerType: string }>;
  action: DisposalAction;
}) {
  const [state, formAction] = useActionState<ActionResult<DisposalResult> | null, FormData>(
    async (prev, formData) => action(prev, formData),
    null,
  );
  const [channel, setChannel] = useState("COOP");

  const needsCustomer = ["COOP", "PROCESSOR", "INSTITUTION", "HOUSEHOLD", "SHOP", "MILK_ATM"].includes(channel);
  const needsReason = LOSS_CHANNELS.has(channel);

  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold">Record where milk went</h2>

      {state?.ok ? (
        <div className="mb-3 space-y-2">
          <Receipt
            title={state.message ?? "Recorded"}
            lines={[
              `${state.data.litres} L — ${state.data.channel.replace(/_/g, " ").toLowerCase()}`,
              ...(state.data.rateKesPerLitre
                ? [`KES ${state.data.rateKesPerLitre} a litre — KES ${state.data.valueKes.toLocaleString()}`]
                : []),
            ]}
            refCode={state.refCode}
            tone={state.data.forcedL > 0 ? "danger" : "ok"}
          />
          {state.data.blockMessage ? <HardBlock message={state.data.blockMessage} /> : null}
          {state.data.legality?.blockers.map((b) => <SoftWarning key={b} message={b} />)}
          {state.data.legality?.warnings.map((w) => <SoftWarning key={w} message={w} />)}
        </div>
      ) : null}

      {state && !state.ok ? <div className="mb-3"><HardBlock message={state.error} /></div> : null}

      <form action={formAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="date" value={date} />

        <Field label="Where did it go?">
          <Select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {["Sold", "Given", "Lost"].map((group) => (
              <optgroup key={group} label={group}>
                {CHANNELS.filter((c) => c.group === group).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <Field label="Litres">
          <TextInput name="litres" type="number" inputMode="decimal" step="0.1" min="0" required />
        </Field>

        {needsCustomer ? (
          <Field label="Who took it?" hint="Leave blank for a walk-in.">
            <Select name="customerId" defaultValue="">
              <option value="">—</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {needsReason ? (
          <Field label="What happened?">
            <Select name="lossReason" defaultValue="SPOILAGE">
              {LOSS_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Price a litre" hint="Leave blank to use the current price list.">
          <TextInput name="rateKesPerLitre" type="number" inputMode="decimal" step="0.5" min="0" />
        </Field>

        <div className="sm:col-span-2">
          <SubmitButton />
        </div>
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Record"}
    </Button>
  );
}

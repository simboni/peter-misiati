"use client";

import { useActionState, useState } from "react";
import {
  ErrorBanner,
  Field,
  Money,
  MoreFields,
  Picker,
  ReceiptCard,
  SubmitButton,
  Text,
  kesText,
  type FormAction,
  type Result,
} from "@/components/money/form-kit";

export interface AnimalOption {
  id: string;
  label: string;
  classLabel: string;
  dailyYieldL: number | null;
  daysInMilk: number | null;
  monthsPregnant: number | null;
}

export interface ClassOption {
  value: string;
  label: string;
}

interface Lifetime {
  tag: string;
  totalLitres: number;
  calvesBorn: number;
  milkRevenueKes: number;
  feedCostKes: number;
  vetCostKes: number;
  breedingCostKes: number;
  purchasePriceKes: number;
  saleValueKes: number;
  profitKes: number;
  summary: string;
}

type SaleData = {
  exitId: string;
  incomeId: string | null;
  refCode: string;
  lifetime: Lifetime;
  priceDrivers: string[];
};

/* ---------------------------------------------------------------- */

/**
 * The sale form. Every field on it is a Kenyan price driver, because the point
 * of recording a sale is to be able to justify the next asking price.
 */
export function SaleForm({
  action,
  animals,
  classes,
  buyers,
  today,
}: {
  action: FormAction<SaleData>;
  animals: AnimalOption[];
  classes: ClassOption[];
  buyers: Array<{ id: string; name: string }>;
  today: string;
}) {
  const [state, formAction] = useActionState<Result<SaleData> | null, FormData>(action, null);
  const [animalId, setAnimalId] = useState(animals[0]?.id ?? "");
  const chosen = animals.find((a) => a.id === animalId);

  if (state?.ok) {
    const life = state.data.lifetime;
    return (
      <ReceiptCard
        title={`${life.tag} left the herd`}
        refCode={state.data.refCode}
        lines={[
          state.data.priceDrivers.length ? `Priced on: ${state.data.priceDrivers.join(", ")}.` : "",
          life.summary,
          state.data.incomeId
            ? "The sale is in the cash book, waiting for a manager to approve it."
            : "",
        ]}
      >
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <LifeRow label="Milk she gave" value={`${life.totalLitres.toLocaleString()} L`} />
          <LifeRow label="Worth about" value={kesText(life.milkRevenueKes)} />
          <LifeRow label="Calves born" value={String(life.calvesBorn)} />
          <LifeRow label="Sold for" value={kesText(life.saleValueKes)} />
          <LifeRow label="Feed charged to her" value={kesText(life.feedCostKes)} />
          <LifeRow label="Vet and breeding" value={kesText(life.vetCostKes + life.breedingCostKes)} />
          {life.purchasePriceKes > 0 ? (
            <LifeRow label="What she cost to buy" value={kesText(life.purchasePriceKes)} />
          ) : null}
          <LifeRow
            label={life.profitKes >= 0 ? "Ahead by" : "Behind by"}
            value={kesText(Math.abs(life.profitKes))}
            strong
          />
        </dl>
        <a href="/trading" className="mt-4 inline-block text-sm underline">
          Back to buying and selling
        </a>
      </ReceiptCard>
    );
  }

  return (
    <div className="space-y-4">
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <form action={formAction} className="space-y-4">
        <Field label="Which animal?" errors={state && !state.ok ? state.fieldErrors?.animalId : undefined}>
          <Picker
            name="animalId"
            value={animalId}
            onChange={(e) => setAnimalId(e.target.value)}
            required
          >
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.classLabel}
              </option>
            ))}
          </Picker>
        </Field>

        <Field
          label="Price agreed"
          hint="Shillings. Never filled in for you."
          errors={state && !state.ok ? state.fieldErrors?.priceKes : undefined}
        >
          <Money name="priceKes" required placeholder="0" />
        </Field>

        <Field label="On what day?">
          <Text type="date" name="exitDate" defaultValue={today} required />
        </Field>

        <Field label="Why did she leave?">
          <Picker name="reason" defaultValue="SOLD">
            <option value="SOLD">Sold</option>
            <option value="CULLED">Culled</option>
            <option value="SLAUGHTERED">Slaughtered</option>
            <option value="DIED">Died</option>
            <option value="STOLEN">Stolen</option>
            <option value="LOST">Lost</option>
          </Picker>
        </Field>

        <Field label="Who bought her?">
          <Picker name="counterpartyKind" defaultValue="FARMER">
            <option value="FARMER">Another farmer</option>
            <option value="BROKER">Broker</option>
            <option value="COOP">Co-operative</option>
            <option value="BUTCHERY">Butchery</option>
            <option value="KMC">Kenya Meat Commission</option>
            <option value="AUCTION">Auction / market</option>
            <option value="OTHER">Someone else</option>
          </Picker>
        </Field>

        {/* The price drivers. Prefilled from her records and LABELLED as such (R5). */}
        <MoreFields label="What she was priced on">
          <p className="text-xs text-ink-3">
            Filled in from her records where we have them. Correct anything that is wrong — this is
            what justifies the price next time.
          </p>

          <Field label="Class at sale">
            <Picker name="classAtExit" defaultValue={""}>
              <option value="">Work it out from her records</option>
              {classes.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Picker>
          </Field>

          <Field
            label="Months in calf"
            hint="A seven-month in-calf heifer carries a large premium."
          >
            <Text
              type="number"
              step="0.5"
              min="0"
              max="10"
              name="monthsPregnant"
              defaultValue={chosen?.monthsPregnant ?? ""}
            />
          </Field>

          <Field
            label="Litres a day right now"
            hint="A milking cow is priced per litre. This is the number the buyer asks for."
          >
            <Text
              type="number"
              step="0.1"
              min="0"
              name="dailyYieldAtSaleL"
              defaultValue={chosen?.dailyYieldL ?? ""}
            />
          </Field>

          <Field label="Days in milk">
            <Text type="number" min="0" name="daysInMilkAtSale" defaultValue={chosen?.daysInMilk ?? ""} />
          </Field>

          <Field label="Weight in kilograms" hint="For a beef or cull sale, priced by liveweight.">
            <Text type="number" step="1" min="0" name="weightKg" />
          </Field>

          <Field label="Buyer on your supplier list">
            <Picker name="counterpartyId" defaultValue="">
              <option value="">—</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Picker>
          </Field>

          <Field label="How were you paid?">
            <Picker name="paymentMethod" defaultValue="MPESA">
              {["MPESA", "CASH", "BANK", "CHEQUE", "CREDIT"].map((m) => (
                <option key={m} value={m}>
                  {m[0] + m.slice(1).toLowerCase()}
                </option>
              ))}
            </Picker>
          </Field>

          <Field label="M-Pesa confirmation code">
            <Text name="mpesaRef" autoCapitalize="characters" />
          </Field>
        </MoreFields>

        <SubmitButton>Record the sale</SubmitButton>
      </form>
    </div>
  );
}

function LifeRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className={`text-ink-2 ${strong ? "font-semibold text-ink" : ""}`}>{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </>
  );
}

/* ---------------------------------------------------------------- */

type PurchaseData = {
  animalId: string;
  refCode: string;
  dobEstimated: boolean;
  reminders: string[];
};

export function PurchaseForm({
  action,
  classes,
  sellers,
  today,
}: {
  action: FormAction<PurchaseData>;
  classes: ClassOption[];
  sellers: Array<{ id: string; name: string }>;
  today: string;
}) {
  const [state, formAction] = useActionState<Result<PurchaseData> | null, FormData>(action, null);
  const [knowsDob, setKnowsDob] = useState(false);

  if (state?.ok) {
    return (
      <ReceiptCard
        title={state.message ?? "Animal entered the herd."}
        refCode={state.data.refCode}
        tone="warn"
        lines={state.data.reminders}
      >
        <div className="mt-4 flex gap-3">
          <a href={`/herd/${state.data.animalId}`} className="text-sm underline">
            Open her record
          </a>
          <a href="/trading/buy" className="text-sm underline">
            Buy another
          </a>
        </div>
      </ReceiptCard>
    );
  }

  return (
    <div className="space-y-4">
      {state && !state.ok ? <ErrorBanner message={state.error} /> : null}

      <form action={formAction} className="space-y-4">
        <Field label="Tag" errors={state && !state.ok ? state.fieldErrors?.tag : undefined}>
          <Text name="tag" required autoFocus autoCapitalize="characters" />
        </Field>

        <Field label="Name" hint="What you will actually call her.">
          <Text name="name" />
        </Field>

        <Field
          label="Price paid"
          hint="Shillings. Never filled in for you."
          errors={state && !state.ok ? state.fieldErrors?.priceKes : undefined}
        >
          <Money name="priceKes" required placeholder="0" />
        </Field>

        <Field label="Day she arrived">
          <Text type="date" name="enteredHerdOn" defaultValue={today} required />
        </Field>

        {/*
          A bought-in animal has no calvings or services in this database, so
          her class cannot be derived. This is the one place typing it is right.
        */}
        <Field
          label="What is she?"
          hint="She has no history here yet, so tell us. Once she calves or is served on this farm, her class comes from those events instead."
        >
          <Picker name="classOverride" defaultValue="">
            <option value="">Not sure</option>
            {classes.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Picker>
        </Field>

        <MoreFields label="Age, breed and the seller">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={knowsDob}
              onChange={(e) => setKnowsDob(e.target.checked)}
            />
            The seller gave me her exact date of birth
          </label>

          {knowsDob ? (
            <Field label="Date of birth">
              <Text type="date" name="dateOfBirth" />
            </Field>
          ) : (
            <Field
              label="Roughly how old, in months?"
              hint="We will mark her date of birth as an estimate, so nobody later mistakes a guess for a fact."
            >
              <Text type="number" min="0" max="300" name="ageMonthsEstimate" />
            </Field>
          )}

          <Field label="Breed">
            <Text name="primaryBreed" placeholder="Friesian, Ayrshire, Guernsey…" />
          </Field>

          <Field label="Breed composition">
            <Text name="breedComposition" placeholder="3/4 Friesian x 1/4 Zebu" />
          </Field>

          <Field label="Months in calf, if she is">
            <Text type="number" step="0.5" min="0" max="10" name="monthsPregnant" />
          </Field>

          <Field label="Litres a day, if she is milking">
            <Text type="number" step="0.1" min="0" name="dailyYieldL" />
          </Field>

          <Field label="KLBA registration number" hint="A registered animal with records fetches materially more.">
            <Text name="klbaRegNo" />
          </Field>

          <Field label="Seller on your supplier list">
            <Picker name="counterpartyId" defaultValue="">
              <option value="">—</option>
              {sellers.map((sup) => (
                <option key={sup.id} value={sup.id}>
                  {sup.name}
                </option>
              ))}
            </Picker>
          </Field>

          <Field label="Who did you buy from?">
            <Picker name="counterpartyKind" defaultValue="FARMER">
              <option value="FARMER">Another farmer</option>
              <option value="BROKER">Broker</option>
              <option value="COOP">Co-operative</option>
              <option value="AUCTION">Auction / market</option>
              <option value="OTHER">Someone else</option>
            </Picker>
          </Field>
        </MoreFields>

        <SubmitButton>Record the purchase</SubmitButton>
      </form>
    </div>
  );
}

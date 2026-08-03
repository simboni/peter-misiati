import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { kes } from "@/lib/money";
import {
  COUNTERPARTY_TYPES,
  COUNTERPARTY_TYPE_LABEL,
  createCounterpartyAction,
  listCounterparties,
} from "@/server/money";
import { SupplierForm } from "@/components/money/entry-forms";
import { Card, Chip, EmptyState, Num, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const session = await verifySession();
  const suppliers = await listCounterparties(session);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <Link href="/money" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> Money
      </Link>
      <PageTitle sub="Agrovets, feed millers, hay, AI, vets, transporters, the co-op.">
        Who you buy from
      </PageTitle>

      {suppliers.length === 0 ? (
        <EmptyState
          title="No suppliers yet"
          hint="Add the ones you use most — the agrovet, the feed miller, the AI technician."
        />
      ) : (
        <ul className="mb-6 space-y-3">
          {suppliers.map((s) => (
            <li key={s.id}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{s.name}</span>
                  <span className="tabular-nums text-sm">
                    <Num>{kes(s.spendKes)}</Num> paid
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.types.map((t) => (
                    <Chip key={t}>
                      {COUNTERPARTY_TYPE_LABEL[t as keyof typeof COUNTERPARTY_TYPE_LABEL] ?? t}
                    </Chip>
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-3">
                  {s.phone ? `${s.phone} · ` : ""}
                  {s.paymentTerms ? `${s.paymentTerms} · ` : ""}
                  {s.lastPurchaseOn ? `last bought ${s.lastPurchaseOn}` : "nothing bought yet"}
                </p>
                {s.creditBalanceKes > 0 ? (
                  <p className="mt-2 text-sm text-brass">
                    <span aria-hidden className="mr-1">
                      ⚠
                    </span>
                    You owe them {kes(s.creditBalanceKes)}.
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Add a supplier</h2>
        <SupplierForm
          action={createCounterpartyAction}
          types={COUNTERPARTY_TYPES.map((t) => ({ value: t, label: COUNTERPARTY_TYPE_LABEL[t] }))}
        />
      </Card>
    </main>
  );
}

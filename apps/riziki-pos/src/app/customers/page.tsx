import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  debtors,
  totalOwed,
  listCustomers,
  waLink,
  reminderMessage,
  isOverLimit,
  AGE_LABEL,
  AGE_TONE,
} from "@/lib/credit";
import { formatKes, formatDate } from "@/lib/units";
import { Card, PageTitle, SectionLabel, Chip, Stat, Empty, TableWrap, Th, Td } from "@/components/ui";
import { CustomerForm } from "./forms";

export const dynamic = "force-dynamic";

/**
 * The debtors book.
 *
 * Client research put this ahead of every other report: a credit-selling shop
 * lives or dies on who owes what and for how long. So the page leads with the
 * one number the owner opens the app for, then the list in the order he will
 * work it — biggest first, with the 30-day-old accounts marked in red.
 */
export default async function CustomersPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const rows = debtors();
  const owed = totalOwed();
  const overdue = rows.filter((r) => r.band === "old");
  const everyone = listCustomers();
  const owing = new Set(rows.map((r) => r.id));
  const settled = everyone.filter((c) => !owing.has(c.id));

  return (
    <div>
      <PageTitle title="Debtors" subtitle="Who owes what, oldest debts first" />

      <div className="grid grid-cols-2 gap-2.5">
        <Stat
          label="Total owed"
          value={formatKes(owed)}
          detail={`${rows.length} ${rows.length === 1 ? "customer" : "customers"}`}
        />
        <Stat
          label="Over 30 days"
          value={formatKes(overdue.reduce((s, r) => s + r.balance_cents, 0))}
          detail={overdue.length ? `${overdue.length} to chase` : "nothing overdue"}
        />
      </div>

      <SectionLabel>Owing now</SectionLabel>
      {rows.length ? (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const over = isOverLimit(r, r.balance_cents);
            return (
              <Card key={r.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/customers/${r.id}`} className="block truncate font-bold text-ink">
                      {r.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted">
                      {r.phone || "no phone"} · {r.open_sales} unpaid{" "}
                      {r.open_sales === 1 ? "sale" : "sales"} · since {formatDate(r.oldest_at)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-extrabold tnum">{formatKes(r.balance_cents)}</div>
                    <div className="mt-1">
                      <Chip tone={AGE_TONE[r.band]}>{AGE_LABEL[r.band]}</Chip>
                    </div>
                  </div>
                </div>

                {over ? (
                  <p className="rounded-lg bg-bad-soft px-2.5 py-1.5 text-xs font-semibold text-bad">
                    Over the {formatKes(r.credit_limit_cents)} limit agreed with this customer.
                  </p>
                ) : null}

                <div className="flex gap-2 pt-0.5">
                  <Link
                    href={`/customers/${r.id}`}
                    className="flex-1 rounded-xl border border-line px-3 py-2 text-center text-xs font-bold hover:bg-wash"
                  >
                    Record payment
                  </Link>
                  {/*
                    The shop already chases debts on WhatsApp, so the reminder is a
                    pre-typed wa.me deep link rather than a message we send for him.
                  */}
                  <a
                    href={waLink(r.phone, reminderMessage(r.name, r.balance_cents, r.oldest_at))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-xl bg-good-soft px-3 py-2 text-center text-xs font-bold text-good"
                  >
                    Remind on WhatsApp
                  </a>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <Empty>Nobody owes anything. Every sale is settled.</Empty>
        </Card>
      )}

      <SectionLabel>Everyone else</SectionLabel>
      {settled.length ? (
        <TableWrap>
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Phone</Th>
              <Th align="right">Limit</Th>
            </tr>
          </thead>
          <tbody>
            {settled.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link href={`/customers/${c.id}`} className="font-semibold text-brand">
                    {c.name}
                  </Link>
                  <span className="ml-1.5 text-[11px] text-muted">
                    {c.kind === "wholesale" ? "wholesale" : "retail"}
                  </span>
                </Td>
                <Td>{c.phone || "—"}</Td>
                <Td align="right">{c.credit_limit_cents ? formatKes(c.credit_limit_cents) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <Card>
          <Empty>No other customers on file.</Empty>
        </Card>
      )}

      <SectionLabel>Add a customer</SectionLabel>
      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-bold text-brand">New customer</summary>
          <div className="mt-4">
            <CustomerForm />
          </div>
        </details>
      </Card>
    </div>
  );
}

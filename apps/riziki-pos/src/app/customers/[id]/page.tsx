import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  getCustomer,
  balanceOf,
  customerSales,
  openSales,
  isOverLimit,
  ageDays,
  ageBand,
  waLink,
  reminderMessage,
  AGE_LABEL,
  AGE_TONE,
} from "@/lib/credit";
import { formatKes, formatDateTime, pct } from "@/lib/units";
import { Card, PageTitle, SectionLabel, Chip, Stat, Alert, Empty, TableWrap, Th, Td } from "@/components/ui";
import { CustomerForm, PaymentForm } from "../forms";

export const dynamic = "force-dynamic";

/** One customer's account: what they owe, since when, and how to settle it. */
export default async function CustomerPage(props: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  // `params` is a Promise in Next.js 16 — synchronous access was removed.
  const { id } = await props.params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId)) notFound();

  const customer = getCustomer(customerId);
  if (!customer) notFound();

  const balance = balanceOf(customerId);
  const open = openSales(customerId);
  const sales = customerSales(customerId);
  const over = isOverLimit(customer, balance);
  const oldest = open[0];
  const days = oldest ? ageDays(oldest.at) : 0;
  const band = oldest ? ageBand(days) : "none";

  const headroom = customer.credit_limit_cents - balance;

  return (
    <div>
      <PageTitle
        title={customer.name}
        subtitle={`${customer.kind === "wholesale" ? "Wholesale" : "Retail"} · ${customer.phone || "no phone on file"}`}
      />

      <div className="grid grid-cols-2 gap-2.5">
        <Stat
          label="Outstanding"
          value={formatKes(balance)}
          detail={open.length ? `${open.length} unpaid ${open.length === 1 ? "sale" : "sales"}` : "account clear"}
        />
        <Stat
          label="Credit limit"
          value={customer.credit_limit_cents ? formatKes(customer.credit_limit_cents) : "none set"}
          detail={
            customer.credit_limit_cents
              ? over
                ? `${formatKes(-headroom)} over`
                : `${formatKes(headroom)} left`
              : "no limit agreed"
          }
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {oldest ? <Chip tone={AGE_TONE[band]}>Oldest debt {AGE_LABEL[band]}</Chip> : <Chip tone="good">Settled</Chip>}
        {customer.kra_pin ? <Chip tone="brand">KRA {customer.kra_pin}</Chip> : null}
        {balance > 0 ? (
          <a
            href={waLink(customer.phone, reminderMessage(customer.name, balance, oldest?.at))}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-good-soft px-3 py-1 text-[11px] font-bold text-good"
          >
            Remind on WhatsApp
          </a>
        ) : null}
      </div>

      {over ? (
        <div className="mt-3">
          <Alert tone="bad">
            Over the agreed limit by {formatKes(-headroom)} ({Math.round(pct(balance, customer.credit_limit_cents))}%
            of the limit used). Take payment before selling more on credit.
          </Alert>
        </div>
      ) : null}

      <SectionLabel>Record a payment</SectionLabel>
      <Card>
        {balance > 0 ? (
          <PaymentForm customerId={customerId} balanceCents={balance} openSales={open.length} />
        ) : (
          <Empty>Nothing outstanding to pay off.</Empty>
        )}
      </Card>

      {open.length ? (
        <>
          <SectionLabel>Unpaid, oldest first</SectionLabel>
          <TableWrap>
            <thead>
              <tr>
                <Th>Sale</Th>
                <Th align="right">Total</Th>
                <Th align="right">Paid</Th>
                <Th align="right">Due</Th>
              </tr>
            </thead>
            <tbody>
              {open.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/invoice/${s.id}`} className="font-semibold text-brand">
                      {s.invoice_no ?? `Sale #${s.id}`}
                    </Link>
                    <div className="text-[11px] text-muted">{formatDateTime(s.at)}</div>
                  </Td>
                  <Td align="right">{formatKes(s.total_cents)}</Td>
                  <Td align="right">{formatKes(s.paid_cents)}</Td>
                  <Td align="right" className="font-bold">
                    {formatKes(s.due_cents)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      ) : null}

      <SectionLabel>Full history</SectionLabel>
      {sales.length ? (
        <TableWrap>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Invoice</Th>
              <Th align="right">Total</Th>
              <Th align="right">Balance</Th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => {
              const due = s.status === "voided" ? 0 : s.total_cents - s.paid_cents;
              return (
                <tr key={s.id}>
                  <Td>
                    {formatDateTime(s.at)}
                    {s.status === "voided" ? (
                      <span className="ml-1.5 text-[11px] font-bold text-bad">voided</span>
                    ) : null}
                  </Td>
                  <Td>
                    <Link href={`/invoice/${s.id}`} className="font-semibold text-brand">
                      {s.invoice_no ?? `#${s.id}`}
                    </Link>
                  </Td>
                  <Td align="right">{formatKes(s.total_cents)}</Td>
                  <Td align="right" className={due > 0 ? "font-bold text-bad" : "text-muted"}>
                    {due > 0 ? formatKes(due) : "paid"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      ) : (
        <Card>
          <Empty>No sales recorded for this customer yet.</Empty>
        </Card>
      )}

      <SectionLabel>Details</SectionLabel>
      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-bold text-brand">Edit customer</summary>
          <div className="mt-4">
            <CustomerForm customer={customer} />
          </div>
        </details>
      </Card>

      <div className="mt-4">
        <Link href="/customers" className="text-sm font-bold text-brand">
          ← All debtors
        </Link>
      </div>
    </div>
  );
}

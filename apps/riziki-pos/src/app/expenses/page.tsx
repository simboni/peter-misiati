/**
 * Expenses — one screen, a few taps.
 *
 * Without this the monthly report shows revenue and calls it profit. Rent,
 * transport and casual labour are the difference between a shop that looks
 * healthy and one that is. Entry is deliberately blunt: pick a category, type
 * an amount, pick cash or M-Pesa, done. No dropdown hunting.
 *
 * There is no date picker either — an expense is recorded when it is paid, and
 * the timestamp is the Nairobi business date. Backdating would let a bad day be
 * tidied up after the fact.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, requireUser } from "@/lib/auth";
import { run, audit } from "@/lib/db";
import { formatKes, toCents, businessDate, formatDateTime } from "@/lib/units";
import {
  EXPENSE_CATEGORIES,
  isExpenseCategory,
  expensesForMonth,
  expenseTotalForMonth,
  expensesByCategory,
  monthKey,
} from "@/lib/reports";
import {
  PageTitle,
  Card,
  SectionLabel,
  Button,
  Field,
  inputClass,
  TableWrap,
  Th,
  Td,
  Empty,
  Alert,
  Stat,
} from "@/components/ui";
import { ExportButtons } from "@/components/export-buttons";

export const dynamic = "force-dynamic";

async function addExpense(formData: FormData) {
  "use server";

  const user = await requireUser();

  const category = String(formData.get("category") ?? "");
  const method = String(formData.get("method") ?? "cash");
  const raw = String(formData.get("amount") ?? "").trim();
  const shillings = Number(raw);

  if (!isExpenseCategory(category)) redirect("/expenses?error=category");
  if (raw === "" || !Number.isFinite(shillings) || shillings <= 0) {
    redirect("/expenses?error=amount");
  }
  if (method !== "cash" && method !== "mpesa") redirect("/expenses?error=method");

  const amount = toCents(shillings);
  const note = String(formData.get("note") ?? "").slice(0, 200);

  const { lastInsertRowid } = run(
    `INSERT INTO expenses (category, amount_cents, method, note, user_id)
     VALUES (?, ?, ?, ?, ?)`,
    category,
    amount,
    method,
    note,
    user.id,
  );
  audit(user.id, "expense_add", "expense", lastInsertRowid, `${category} ${amount} ${method}`);

  revalidatePath("/expenses");
  revalidatePath("/day-close");
  redirect("/expenses?saved=1");
}

const ERRORS: Record<string, string> = {
  amount: "Enter an amount greater than zero.",
  category: "Pick a category.",
  method: "Pick cash or M-Pesa.",
};

export default async function ExpensesPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  // `searchParams` is a Promise in Next.js 16 — synchronous access was removed.
  const { saved, error } = await props.searchParams;

  const user = await currentUser();
  if (!user) redirect("/login");

  const ym = monthKey(businessDate());
  const rows = expensesForMonth(ym);
  const { totalCents, count } = expenseTotalForMonth(ym);
  const byCategory = expensesByCategory(ym);
  const cashCents = rows
    .filter((r) => r.method === "cash")
    .reduce((sum, r) => sum + r.amount_cents, 0);

  const monthName = new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div>
      <PageTitle title="Expenses" subtitle={`${monthName} · what the shop paid out`} />

      <div className="mb-3">
        <ExportButtons csv="expenses" label={`expenses for ${monthName}`} />
      </div>

      {/*
        Entering an expense and totting the month up are both narrow tasks; the
        list of entries is a table and wants the width. Past `xl` the table
        moves up beside them — before, not one entry was visible on a 1366
        laptop without scrolling, which made it easy to record the same rent
        twice.
      */}
      <div className="xl:grid xl:grid-cols-5 xl:items-start xl:gap-x-5">
      <div className="xl:col-span-2">
      <Card>
        <form action={addExpense} className="space-y-3 xl:space-y-3.5">
          {error ? <Alert tone="bad">{ERRORS[error] ?? "Could not save that expense."}</Alert> : null}
          {saved ? <Alert tone="good">Expense recorded.</Alert> : null}

          <fieldset>
            <legend className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
              Category
            </legend>
            <div className="flex flex-wrap gap-2">
              {EXPENSE_CATEGORIES.map((c, i) => (
                <label key={c} className="cursor-pointer">
                  <input
                    type="radio"
                    name="category"
                    value={c}
                    defaultChecked={i === 0}
                    className="peer sr-only"
                  />
                  <span className="flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-semibold xl:min-h-9 peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                    {c}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="Amount (KES)">
            <input
              className={`${inputClass} text-2xl font-extrabold tnum`}
              type="number"
              name="amount"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              autoComplete="off"
              placeholder="0"
              required
            />
          </Field>

          <fieldset>
            <legend className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
              Paid with
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["cash", "Cash"],
                  ["mpesa", "M-Pesa"],
                ] as const
              ).map(([value, label], i) => (
                <label key={value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="method"
                    value={value}
                    defaultChecked={i === 0}
                    className="peer sr-only"
                  />
                  <span className="flex min-h-12 items-center justify-center rounded-xl border border-line px-3 text-center text-sm font-bold xl:min-h-10 peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                    {label}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">
              Cash expenses come straight out of tonight’s expected drawer.
            </p>
          </fieldset>

          <Field label="Note" hint="Optional — who or what it was for.">
            <input className={inputClass} type="text" name="note" maxLength={200} autoComplete="off" />
          </Field>

          <Button type="submit" className="w-full">
            Record expense
          </Button>
        </form>
      </Card>
      <SectionLabel>This month</SectionLabel>
      <div className="grid grid-cols-2 gap-2.5 xl:gap-3">
        <Stat
          label="Total spent"
          value={formatKes(totalCents)}
          detail={`${count} ${count === 1 ? "entry" : "entries"}`}
        />
        <Stat label="Of which cash" value={formatKes(cashCents)} detail="left the drawer" />
      </div>

      {byCategory.length > 1 ? (
        <Card className="mt-2.5">
          <ul className="space-y-1.5 text-sm">
            {byCategory.map((c) => (
              <li key={c.category} className="flex items-baseline justify-between gap-3">
                <span className="text-muted">{c.category}</span>
                <span className="font-semibold tnum">{formatKes(c.total_cents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      </div>

      <div className="xl:col-span-3">
      <SectionLabel>Entries</SectionLabel>
      {rows.length ? (
        <TableWrap>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Category</Th>
              <Th>Paid with</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <div>{formatDateTime(r.at)}</div>
                  {r.note ? <div className="text-xs text-muted">{r.note}</div> : null}
                </Td>
                <Td>{r.category}</Td>
                <Td>{r.method === "cash" ? "Cash" : "M-Pesa"}</Td>
                <Td align="right">{formatKes(r.amount_cents)}</Td>
              </tr>
            ))}
            <tr>
              <Td className="font-bold">Total</Td>
              <Td>{null}</Td>
              <Td>{null}</Td>
              <Td align="right" className="font-extrabold">
                {formatKes(totalCents)}
              </Td>
            </tr>
          </tbody>
        </TableWrap>
      ) : (
        <Card>
          <Empty>Nothing recorded this month yet.</Empty>
        </Card>
      )}
      </div>
      </div>
    </div>
  );
}

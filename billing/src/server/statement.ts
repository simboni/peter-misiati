import { and, eq, ne } from "drizzle-orm";
import { schema, type DB } from "./db";

export type StatementEntry = {
  date: Date;
  ms: number;
  doc: string;
  kind: "invoice" | "payment" | "credit";
  description: string;
  debit: number; // increases what the client owes (minor units)
  credit: number; // decreases what the client owes (minor units)
  balance: number; // running balance after this entry
};

export type Statement = {
  entries: StatementEntry[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  currency: string;
};

const METHOD_LABELS: Record<string, string> = {
  mpesa: "M-Pesa",
  cash: "Cash",
  bank: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

/**
 * Build a client's statement of account — every invoice (a debit), payment and
 * credit note (credits) in date order, with a running balance. The closing
 * balance is what the client currently owes.
 */
export async function buildStatement(
  db: DB,
  organizationId: string,
  clientId: string,
  currency: string,
): Promise<Statement> {
  const [invoices, payments, credits] = await Promise.all([
    db
      .select({ number: schema.invoice.number, issueDate: schema.invoice.issueDate, total: schema.invoice.total })
      .from(schema.invoice)
      .where(
        and(
          eq(schema.invoice.organizationId, organizationId),
          eq(schema.invoice.clientId, clientId),
          eq(schema.invoice.type, "invoice"),
          ne(schema.invoice.status, "void"),
        ),
      ),
    db
      .select({ number: schema.payment.number, paidAt: schema.payment.paidAt, amount: schema.payment.amount, method: schema.payment.method })
      .from(schema.payment)
      .where(and(eq(schema.payment.organizationId, organizationId), eq(schema.payment.clientId, clientId))),
    db
      .select({ number: schema.creditNote.number, issueDate: schema.creditNote.issueDate, total: schema.creditNote.total })
      .from(schema.creditNote)
      .where(and(eq(schema.creditNote.organizationId, organizationId), eq(schema.creditNote.clientId, clientId))),
  ]);

  const raw: Omit<StatementEntry, "balance">[] = [
    ...invoices.map((i) => ({
      date: new Date(i.issueDate),
      ms: new Date(i.issueDate).getTime(),
      doc: i.number,
      kind: "invoice" as const,
      description: "Invoice",
      debit: i.total,
      credit: 0,
    })),
    ...payments.map((p) => ({
      date: new Date(p.paidAt),
      ms: new Date(p.paidAt).getTime(),
      doc: p.number,
      kind: "payment" as const,
      description: `Payment — ${METHOD_LABELS[p.method] ?? p.method}`,
      debit: 0,
      credit: p.amount,
    })),
    ...credits.map((c) => ({
      date: new Date(c.issueDate),
      ms: new Date(c.issueDate).getTime(),
      doc: c.number,
      kind: "credit" as const,
      description: "Credit note",
      debit: 0,
      credit: c.total,
    })),
  ];

  // Order by date, then debits (invoices) before credits on the same day.
  raw.sort((a, b) => a.ms - b.ms || b.debit - a.debit);

  let balance = 0;
  const entries: StatementEntry[] = raw.map((e) => {
    balance += e.debit - e.credit;
    return { ...e, balance };
  });

  const totalDebit = raw.reduce((s, e) => s + e.debit, 0);
  const totalCredit = raw.reduce((s, e) => s + e.credit, 0);

  return { entries, totalDebit, totalCredit, closingBalance: balance, currency };
}

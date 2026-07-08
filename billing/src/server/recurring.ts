import { and, eq, lte } from "drizzle-orm";
import { schema, type DB } from "./db";
import { allocateNumber } from "./sequence";
import { calcTotals, type DepositType, type DiscountType } from "./totals";

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

/** Advance a date by one recurrence step. Month/quarter/year math clamps the
 *  day-of-month (e.g. Jan 31 + 1 month → Feb 28). */
export function advanceDate(date: Date, frequency: string, interval: number): Date {
  const step = Math.max(1, interval);
  const d = new Date(date);
  if (frequency === "weekly") {
    d.setDate(d.getDate() + 7 * step);
    return d;
  }
  const months = frequency === "yearly" ? 12 * step : frequency === "quarterly" ? 3 * step : step;
  const day = d.getDate();
  d.setDate(1); // avoid roll-over while shifting month
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

const MAX_CATCHUP = 24; // don't spawn more than this many invoices in one run

/**
 * Generate any due invoices for the given org's active schedules and advance
 * them. Idempotent-ish: only creates invoices whose scheduled date has passed.
 * Returns the number of invoices created. Safe to call on every app load.
 */
export async function runDueRecurring(db: DB, organizationId: string, now: Date = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(schema.recurringInvoice)
    .where(
      and(
        eq(schema.recurringInvoice.organizationId, organizationId),
        eq(schema.recurringInvoice.status, "active"),
        lte(schema.recurringInvoice.nextRunDate, now),
      ),
    );

  let created = 0;

  for (const sched of due) {
    const lines = await db
      .select()
      .from(schema.recurringInvoiceLine)
      .where(eq(schema.recurringInvoiceLine.recurringInvoiceId, sched.id))
      .orderBy(schema.recurringInvoiceLine.sortOrder);
    if (lines.length === 0) {
      // nothing to bill — pause so it stops being "due" forever
      await db.update(schema.recurringInvoice).set({ status: "paused" }).where(eq(schema.recurringInvoice.id, sched.id));
      continue;
    }

    let next = new Date(sched.nextRunDate);
    let occurrences = sched.occurrences;
    let status = sched.status;
    let guard = 0;

    while (next.getTime() <= now.getTime() && guard < MAX_CATCHUP) {
      // stop conditions
      if (sched.endDate && next.getTime() > new Date(sched.endDate).getTime()) {
        status = "ended";
        break;
      }
      if (sched.maxOccurrences != null && occurrences >= sched.maxOccurrences) {
        status = "ended";
        break;
      }

      const issueDate = new Date(next);
      const dueDate = sched.dueDays > 0 ? new Date(issueDate.getTime() + sched.dueDays * 86_400_000) : null;

      const t = calcTotals({
        lines: lines.map((l) => ({ quantityMilli: l.quantityMilli, unitPrice: l.unitPrice, taxRateBps: l.taxRateBps })),
        discountType: sched.discountType as DiscountType,
        discountValue: sched.discountValue,
        depositType: sched.depositType as DepositType,
        depositValue: sched.depositValue,
      });

      const number = await allocateNumber(db, organizationId, "invoice");
      const inserted = await db
        .insert(schema.invoice)
        .values({
          organizationId,
          clientId: sched.clientId,
          number,
          type: "invoice",
          status: sched.autoSend ? "sent" : "draft",
          issueDate,
          dueDate,
          currency: sched.currency,
          notes: sched.notes,
          terms: sched.terms,
          discountType: sched.discountType,
          discountValue: sched.discountValue,
          depositType: sched.depositType,
          depositValue: sched.depositValue,
          depositAmount: t.depositAmount,
          subtotal: t.subtotal,
          discountAmount: t.discountAmount,
          taxTotal: t.taxTotal,
          total: t.total,
          amountPaid: 0,
          balanceDue: t.total,
          shareToken: crypto.randomUUID(),
          sentAt: sched.autoSend ? issueDate : null,
        })
        .returning({ id: schema.invoice.id });
      const invId = inserted[0].id;

      await db.insert(schema.invoiceLine).values(
        t.lines.map((l, i) => ({
          invoiceId: invId,
          itemId: lines[i].itemId,
          title: lines[i].title,
          description: lines[i].description,
          quantityMilli: l.quantityMilli,
          unitPrice: l.unitPrice,
          taxRateBps: l.taxRateBps,
          lineSubtotal: l.lineSubtotal,
          taxAmount: l.taxAmount,
          lineTotal: l.lineTotal,
          sortOrder: i,
        })),
      );

      created += 1;
      occurrences += 1;
      next = advanceDate(next, sched.frequency, sched.interval);

      if (sched.maxOccurrences != null && occurrences >= sched.maxOccurrences) {
        status = "ended";
        break;
      }
      if (sched.endDate && next.getTime() > new Date(sched.endDate).getTime()) {
        status = "ended";
        break;
      }
    }

    await db
      .update(schema.recurringInvoice)
      .set({ nextRunDate: next, occurrences, status, lastRunAt: now })
      .where(eq(schema.recurringInvoice.id, sched.id));
  }

  return created;
}

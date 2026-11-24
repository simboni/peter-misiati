/**
 * Payment reminders — deciding who to chase, when, and with what words.
 *
 * The scheduling rules live here as pure functions so they can be tested
 * without a database. Getting this wrong is expensive in a way bugs usually
 * are not: chasing a client who already paid, or chasing the same person three
 * times in a morning, damages a relationship that the invoice exists to serve.
 *
 * Schedule offsets are DAYS RELATIVE TO THE DUE DATE, negative before it:
 *
 *     -3        0        +3       +7       +14
 *   nudge     due day   chase    chase    final
 */

export type Tone = "friendly" | "firm" | "final";

/** Parse the stored CSV schedule into sorted, de-duplicated day offsets. */
export function parseSchedule(csv: string): number[] {
  const out = new Set<number>();
  for (const part of (csv ?? "").split(",")) {
    const trimmed = part.trim();
    // Number("") is 0, so an empty segment from a stray comma would otherwise
    // schedule an unintended chase on the due date.
    if (trimmed === "") continue;
    const n = Number(trimmed);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= -90 && n <= 365) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Whole days between two instants, by calendar date rather than elapsed ms. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

export type DueStepInput = {
  dueDate: Date;
  now: Date;
  schedule: number[];
  /** Offsets already sent for this invoice. */
  sent: number[];
  /** Don't send if something went out within this many days. Default 1. */
  minGapDays?: number;
  /** When the most recent reminder was sent, if any. */
  lastSentAt?: Date | null;
};

/**
 * Which schedule step is due now, or null.
 *
 * Deliberately returns only the LATEST passed step rather than every unsent
 * one. An invoice 20 days overdue that was never chased should get one message
 * about being 14 days overdue — not four messages in a row, which is how an
 * automated system loses a customer.
 */
export function dueStep(input: DueStepInput): number | null {
  const { dueDate, now, schedule, sent } = input;
  const minGap = input.minGapDays ?? 1;

  if (schedule.length === 0) return null;

  // Respect a quiet period after the last send, whichever step is due.
  if (input.lastSentAt && daysBetween(input.lastSentAt, now) < minGap) return null;

  const age = daysBetween(dueDate, now); // negative = not yet due
  const passed = schedule.filter((s) => s <= age);
  if (passed.length === 0) return null;

  const latest = passed[passed.length - 1];
  if (sent.includes(latest)) return null;

  // Earlier steps that were never sent are deliberately skipped, not queued.
  return latest;
}

/** How a step should read, given where it sits relative to the due date. */
export function toneForStep(step: number, configured: Tone): Tone {
  if (step < 0) return "friendly"; // never be firm about a bill that isn't due
  if (configured === "friendly" && step >= 14) return "firm";
  return configured;
}

export type CopyInput = {
  tone: Tone;
  step: number;
  businessName: string;
  clientName: string;
  invoiceNumber: string;
  amountText: string;
  dueDateText: string;
  payUrl: string;
};

/**
 * The message itself. Written to be sent as-is by a small business owner —
 * plain, specific, and never passive-aggressive. The amount, the invoice
 * number and a way to pay appear in every variant, because a reminder without
 * a payment link is just a complaint.
 */
export function reminderCopy(input: CopyInput): { subject: string; body: string } {
  const { step, businessName, clientName, invoiceNumber, amountText, dueDateText, payUrl } = input;
  const tone = toneForStep(step, input.tone);
  const overdueDays = Math.max(0, step);

  if (step < 0) {
    return {
      subject: `${invoiceNumber} from ${businessName} — due ${dueDateText}`,
      body:
        `Hi ${clientName},\n\n` +
        `A quick reminder that invoice ${invoiceNumber} for ${amountText} is due on ${dueDateText}.\n\n` +
        `You can view it and pay here: ${payUrl}\n\n` +
        `Thank you,\n${businessName}`,
    };
  }

  if (step === 0) {
    return {
      subject: `${invoiceNumber} from ${businessName} — due today`,
      body:
        `Hi ${clientName},\n\n` +
        `Invoice ${invoiceNumber} for ${amountText} is due today.\n\n` +
        `View and pay: ${payUrl}\n\n` +
        `If you have already paid, please ignore this.\n\n` +
        `Thank you,\n${businessName}`,
    };
  }

  if (tone === "final") {
    return {
      subject: `${invoiceNumber} — ${overdueDays} days overdue`,
      body:
        `Hi ${clientName},\n\n` +
        `Invoice ${invoiceNumber} for ${amountText} is now ${overdueDays} days overdue and remains unpaid.\n\n` +
        `Please settle it here: ${payUrl}\n\n` +
        `If there is a problem with this invoice, or you need more time, reply to this message so we can agree a plan.\n\n` +
        `${businessName}`,
    };
  }

  if (tone === "firm") {
    return {
      subject: `${invoiceNumber} — ${overdueDays} days overdue`,
      body:
        `Hi ${clientName},\n\n` +
        `Invoice ${invoiceNumber} for ${amountText} was due on ${dueDateText} and is now ${overdueDays} days overdue.\n\n` +
        `Please pay here: ${payUrl}\n\n` +
        `If payment is already on its way, let me know and I'll update our records.\n\n` +
        `Thank you,\n${businessName}`,
    };
  }

  return {
    subject: `${invoiceNumber} from ${businessName} — a gentle reminder`,
    body:
      `Hi ${clientName},\n\n` +
      `Just following up on invoice ${invoiceNumber} for ${amountText}, which was due on ${dueDateText}.\n\n` +
      `You can view and pay it here: ${payUrl}\n\n` +
      `If you have already paid, please ignore this — and thank you.\n\n` +
      `${businessName}`,
  };
}

/** A compact one-liner for WhatsApp, where nobody reads a letter. */
export function whatsappCopy(input: CopyInput): string {
  const { step, businessName, clientName, invoiceNumber, amountText, dueDateText, payUrl } = input;
  if (step < 0) {
    return `Hi ${clientName}, a reminder that invoice ${invoiceNumber} for ${amountText} is due on ${dueDateText}. View and pay: ${payUrl} — ${businessName}`;
  }
  if (step === 0) {
    return `Hi ${clientName}, invoice ${invoiceNumber} for ${amountText} is due today. View and pay: ${payUrl} — ${businessName}`;
  }
  return `Hi ${clientName}, invoice ${invoiceNumber} for ${amountText} is now ${step} days overdue. Please pay here: ${payUrl} — ${businessName}. If you've already paid, kindly ignore.`;
}

/**
 * Whether an invoice is too far gone for AUTOMATIC chasing.
 *
 * A bill most of a year late is not an automation problem — it needs a phone
 * call, a payment plan or a lawyer, and a templated "14 days overdue" nudge
 * reads as incompetence. This also protects the first sweep after a vendor
 * switches reminders on: without a cap, every ancient unpaid invoice on file
 * would be mailed at once, including the many settled in cash and never marked
 * paid. `maxAge` of 0 means no cap.
 */
export function isTooOldToAutoChase(daysOverdue: number, maxAge: number): boolean {
  if (maxAge <= 0) return false;
  return daysOverdue > maxAge;
}

/** Statuses that can still be chased — paid, void and drafts never are. */
export const CHASEABLE_STATUSES = ["sent", "partial", "overdue"] as const;

export type ChaseCandidate = {
  dueDate: Date | null;
  status: string;
  balanceDue: number;
  remindersPaused: boolean;
  clientOptedOut: boolean;
};

/**
 * Whether an invoice is eligible to be chased at all, before any date logic.
 * Separated from dueStep so the reasons are testable and so the UI can explain
 * why something is not in the queue.
 */
export function isChaseable(c: ChaseCandidate, minAmount = 0): boolean {
  if (c.remindersPaused || c.clientOptedOut) return false;
  if (!c.dueDate) return false; // nothing to count from
  if (c.balanceDue <= 0) return false;
  if (c.balanceDue < minAmount) return false;
  return (CHASEABLE_STATUSES as readonly string[]).includes(c.status);
}

/**
 * The reminders engine's database half — loading the chase queue and actually
 * sending. The scheduling rules it leans on are pure functions in reminders.ts.
 *
 * Design note on ordering: a reminder is CLAIMED (its row written) before the
 * email goes out, and the row is marked `failed` if the send then fails. Doing
 * it the other way round means two concurrent page loads can both decide a step
 * is due and both send it. Chasing a client twice in one morning is a worse
 * failure than a nudge that slips to the next step, and the unique index on
 * (invoice_id, step) makes the claim the thing that settles the race.
 */

import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { schema, type DB } from "./db";
import { sendEmail, documentEmailHtml } from "./resend";
import { platformResendConfig } from "./platform";
import { formatMoney } from "./money";
import { fmtDate } from "./queries";
import {
  CHASEABLE_STATUSES,
  dueStep,
  daysBetween,
  isChaseable,
  parseSchedule,
  reminderCopy,
  toneForStep,
  type Tone,
} from "./reminders";

export type ReminderSettings = {
  enabled: boolean;
  schedule: number[];
  tone: Tone;
  autoEmail: boolean;
  minAmount: number;
};

const DEFAULTS: ReminderSettings = {
  enabled: true,
  schedule: [-3, 0, 3, 7, 14],
  tone: "friendly",
  autoEmail: true,
  minAmount: 0,
};

/**
 * The org's sender identity and reminder rules, read straight from the tables.
 *
 * Deliberately NOT via org.ts's getOrgProfile/getOrg: those are wrapped in
 * React `cache()` and assume a request scope, which would make this engine
 * impossible to run from a cron or a CLI. Everything below is plain queries so
 * the engine works wherever it is called from.
 */
async function orgContext(
  db: DB,
  organizationId: string,
): Promise<{ settings: ReminderSettings; businessName: string; replyTo: string | null; footer: string | null }> {
  const [profiles, orgs] = await Promise.all([
    db
      .select({
        remindersEnabled: schema.orgProfile.remindersEnabled,
        reminderSchedule: schema.orgProfile.reminderSchedule,
        reminderTone: schema.orgProfile.reminderTone,
        reminderAutoEmail: schema.orgProfile.reminderAutoEmail,
        reminderMinAmount: schema.orgProfile.reminderMinAmount,
        email: schema.orgProfile.email,
        invoiceFooter: schema.orgProfile.invoiceFooter,
      })
      .from(schema.orgProfile)
      .where(eq(schema.orgProfile.organizationId, organizationId))
      .limit(1),
    db
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1),
  ]);

  const p = profiles[0];
  return {
    settings: p
      ? {
          enabled: p.remindersEnabled,
          schedule: parseSchedule(p.reminderSchedule),
          tone: (["friendly", "firm", "final"].includes(p.reminderTone) ? p.reminderTone : "friendly") as Tone,
          autoEmail: p.reminderAutoEmail,
          minAmount: p.reminderMinAmount,
        }
      : DEFAULTS,
    businessName: orgs[0]?.name ?? "Your business",
    replyTo: p?.email ?? null,
    footer: p?.invoiceFooter ?? null,
  };
}

/** Read an org's reminder settings, falling back to the defaults. */
export async function reminderSettings(db: DB, organizationId: string): Promise<ReminderSettings> {
  return (await orgContext(db, organizationId)).settings;
}

/** Why an invoice is sitting in the queue without being chased. */
export type BlockedReason = "paused" | "client-opted-out" | "no-email" | "below-minimum" | null;

export type ChaseRow = {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  currency: string;
  balanceDue: number;
  dueDate: Date;
  dueDateText: string;
  /** Negative before the due date, positive once overdue. */
  daysOverdue: number;
  /** The schedule step due right now, or null when nothing is due. */
  step: number | null;
  tone: Tone;
  sentSteps: number[];
  lastRemindedAt: Date | null;
  lastFailed: boolean;
  shareToken: string;
  remindersPaused: boolean;
  blocked: BlockedReason;
};

/**
 * Every outstanding invoice worth showing on the chase queue, whether or not a
 * reminder is due. Rows that cannot be chased come back with `blocked` set
 * rather than being dropped, so the page can explain itself instead of quietly
 * showing nothing.
 */
export async function loadChaseQueue(
  db: DB,
  organizationId: string,
  now: Date = new Date(),
): Promise<{ rows: ChaseRow[]; settings: ReminderSettings }> {
  const settings = await reminderSettings(db, organizationId);

  const invoices = await db
    .select({
      id: schema.invoice.id,
      number: schema.invoice.number,
      status: schema.invoice.status,
      dueDate: schema.invoice.dueDate,
      currency: schema.invoice.currency,
      balanceDue: schema.invoice.balanceDue,
      shareToken: schema.invoice.shareToken,
      remindersPaused: schema.invoice.remindersPaused,
      clientId: schema.client.id,
      clientName: schema.client.name,
      clientEmail: schema.client.email,
      clientPhone: schema.client.phone,
      clientOptedOut: schema.client.remindersOptOut,
    })
    .from(schema.invoice)
    .innerJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
    .where(
      and(
        eq(schema.invoice.organizationId, organizationId),
        eq(schema.invoice.type, "invoice"),
        inArray(schema.invoice.status, [...CHASEABLE_STATUSES]),
        isNotNull(schema.invoice.dueDate),
        gt(schema.invoice.balanceDue, 0),
      ),
    );

  if (invoices.length === 0) return { rows: [], settings };

  // One query for the whole send history of these invoices.
  const history = await db
    .select()
    .from(schema.invoiceReminder)
    .where(
      and(
        eq(schema.invoiceReminder.organizationId, organizationId),
        inArray(
          schema.invoiceReminder.invoiceId,
          invoices.map((i) => i.id),
        ),
      ),
    );

  const byInvoice = new Map<string, typeof history>();
  for (const h of history) {
    const arr = byInvoice.get(h.invoiceId) ?? [];
    arr.push(h);
    byInvoice.set(h.invoiceId, arr);
  }

  const rows: ChaseRow[] = invoices.map((inv) => {
    const dueDate = inv.dueDate as Date;
    const sent = byInvoice.get(inv.id) ?? [];
    const sentSteps = sent.map((s) => s.step).sort((a, b) => a - b);
    const latest = sent.reduce<Date | null>(
      (acc, s) => (!acc || new Date(s.sentAt) > acc ? new Date(s.sentAt) : acc),
      null,
    );
    const lastFailed = sent.some((s) => s.status === "failed");

    const chaseable = isChaseable(
      {
        dueDate,
        status: inv.status,
        balanceDue: inv.balanceDue,
        remindersPaused: inv.remindersPaused,
        clientOptedOut: inv.clientOptedOut,
      },
      settings.minAmount,
    );

    const step = chaseable
      ? dueStep({ dueDate, now, schedule: settings.schedule, sent: sentSteps, lastSentAt: latest })
      : null;

    const blocked: BlockedReason = inv.remindersPaused
      ? "paused"
      : inv.clientOptedOut
        ? "client-opted-out"
        : inv.balanceDue < settings.minAmount
          ? "below-minimum"
          : !inv.clientEmail
            ? "no-email"
            : null;

    return {
      id: inv.id,
      number: inv.number,
      clientId: inv.clientId,
      clientName: inv.clientName,
      clientEmail: inv.clientEmail,
      clientPhone: inv.clientPhone,
      currency: inv.currency,
      balanceDue: inv.balanceDue,
      dueDate,
      dueDateText: fmtDate(dueDate),
      daysOverdue: daysBetween(dueDate, now),
      step,
      tone: toneForStep(step ?? Math.max(0, daysBetween(dueDate, now)), settings.tone),
      sentSteps,
      lastRemindedAt: latest,
      lastFailed,
      shareToken: inv.shareToken,
      remindersPaused: inv.remindersPaused,
      blocked,
    };
  });

  // Most overdue first — that is the order someone actually works the queue in.
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { rows, settings };
}

/**
 * Record a chase against an invoice. Returns false when this step was already
 * claimed (the unique index holds the line), unless `force` is set — which a
 * manual re-send uses to refresh the existing row rather than add a second one.
 */
async function claimStep(
  db: DB,
  opts: {
    organizationId: string;
    invoiceId: string;
    step: number;
    channel: string;
    tone: Tone;
    now: Date;
    force?: boolean;
    detail?: string | null;
  },
): Promise<{ claimed: boolean; id: string | null }> {
  const existing = await db
    .select({ id: schema.invoiceReminder.id })
    .from(schema.invoiceReminder)
    .where(
      and(eq(schema.invoiceReminder.invoiceId, opts.invoiceId), eq(schema.invoiceReminder.step, opts.step)),
    )
    .limit(1);

  if (existing[0]) {
    if (!opts.force) return { claimed: false, id: existing[0].id };
    await db
      .update(schema.invoiceReminder)
      .set({
        channel: opts.channel,
        status: "sent",
        tone: opts.tone,
        detail: opts.detail ?? null,
        sentAt: opts.now,
      })
      .where(eq(schema.invoiceReminder.id, existing[0].id));
    return { claimed: true, id: existing[0].id };
  }

  const id = crypto.randomUUID();
  await db.insert(schema.invoiceReminder).values({
    id,
    organizationId: opts.organizationId,
    invoiceId: opts.invoiceId,
    step: opts.step,
    channel: opts.channel,
    status: "sent",
    tone: opts.tone,
    detail: opts.detail ?? null,
    sentAt: opts.now,
  });
  return { claimed: true, id };
}

/**
 * Note a chase the vendor sent themselves (WhatsApp, a phone call, SMS).
 * `now` defaults to this moment but is accepted so a chase made yesterday can
 * be logged with the date it actually happened.
 */
export async function recordManualChase(
  db: DB,
  opts: {
    organizationId: string;
    invoiceId: string;
    step: number;
    channel: string;
    tone: Tone;
    detail?: string | null;
    now?: Date;
  },
): Promise<void> {
  await claimStep(db, { ...opts, now: opts.now ?? new Date(), force: true });
}

export type SendResult = { ok: boolean; error?: string; skipped?: boolean };

/**
 * Email one reminder for one invoice and log it. `step` is the schedule offset
 * the message should read as; a manual send passes the invoice's current age.
 */
export async function sendReminderEmail(
  db: DB,
  opts: {
    organizationId: string;
    invoiceId: string;
    step: number;
    baseUrl: string;
    tone?: Tone;
    force?: boolean;
    now?: Date;
  },
): Promise<SendResult> {
  const now = opts.now ?? new Date();

  const rows = await db
    .select({
      id: schema.invoice.id,
      number: schema.invoice.number,
      status: schema.invoice.status,
      dueDate: schema.invoice.dueDate,
      currency: schema.invoice.currency,
      balanceDue: schema.invoice.balanceDue,
      shareToken: schema.invoice.shareToken,
      remindersPaused: schema.invoice.remindersPaused,
      clientName: schema.client.name,
      clientEmail: schema.client.email,
      clientOptedOut: schema.client.remindersOptOut,
    })
    .from(schema.invoice)
    .innerJoin(schema.client, eq(schema.client.id, schema.invoice.clientId))
    .where(and(eq(schema.invoice.id, opts.invoiceId), eq(schema.invoice.organizationId, opts.organizationId)))
    .limit(1);

  const inv = rows[0];
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (!inv.clientEmail) return { ok: false, error: "This client has no email address saved." };
  if (inv.balanceDue <= 0) return { ok: false, error: "This invoice is already settled." };
  if (inv.clientOptedOut) return { ok: false, error: "This client is opted out of reminders." };

  const ctx = await orgContext(db, opts.organizationId);
  const tone = toneForStep(opts.step, opts.tone ?? ctx.settings.tone);

  // Claim before sending so two concurrent runs cannot both chase this step.
  const claim = await claimStep(db, {
    organizationId: opts.organizationId,
    invoiceId: inv.id,
    step: opts.step,
    channel: "email",
    tone,
    now,
    force: opts.force,
  });
  if (!claim.claimed) return { ok: true, skipped: true };

  const businessName = ctx.businessName;
  const url = `${opts.baseUrl.replace(/\/$/, "")}/d/${inv.shareToken}`;

  const copy = reminderCopy({
    tone,
    step: opts.step,
    businessName,
    clientName: inv.clientName,
    invoiceNumber: inv.number,
    amountText: formatMoney(inv.balanceDue, inv.currency),
    dueDateText: fmtDate(inv.dueDate),
    payUrl: url,
  });

  const result = await sendEmail({
    to: inv.clientEmail,
    replyTo: ctx.replyTo,
    subject: copy.subject,
    html: documentEmailHtml({
      businessName,
      docLabel: `Invoice ${inv.number}`,
      clientName: inv.clientName,
      amountLine: `Balance due: ${formatMoney(inv.balanceDue, inv.currency)}`,
      url,
      canPay: true,
      footer: ctx.footer,
    }),
  });

  if (!result.ok && claim.id) {
    // Keep the claim but mark it failed, so the queue shows it and the vendor
    // can retry by hand instead of the step silently disappearing.
    await db
      .update(schema.invoiceReminder)
      .set({ status: "failed", detail: result.error ?? "send failed" })
      .where(eq(schema.invoiceReminder.id, claim.id));
    return { ok: false, error: result.error };
  }

  return { ok: true };
}

/**
 * Send every reminder that has come due for an org. Called on page load like
 * runDueRecurring, so a vendor who never configures a cron still has their
 * invoices chased whenever they open the app.
 *
 * Returns the number of emails sent.
 */
export async function runDueReminders(
  db: DB,
  organizationId: string,
  baseUrl: string,
  now: Date = new Date(),
): Promise<number> {
  const settings = await reminderSettings(db, organizationId);
  if (!settings.enabled || !settings.autoEmail || settings.schedule.length === 0) return 0;

  // No email configured means every claim would immediately fail and burn its
  // step. Better to do nothing and leave the queue for manual chasing.
  const mail = await platformResendConfig(db);
  if (!mail) return 0;

  const { rows } = await loadChaseQueue(db, organizationId, now);
  const due = rows.filter((r) => r.step !== null && r.blocked === null && r.clientEmail);

  let sent = 0;
  for (const r of due) {
    try {
      const res = await sendReminderEmail(db, {
        organizationId,
        invoiceId: r.id,
        step: r.step as number,
        baseUrl,
        tone: settings.tone,
        now,
      });
      if (res.ok && !res.skipped) sent += 1;
    } catch (e) {
      console.error("runDueReminders: failed on invoice", r.id, e);
    }
  }
  return sent;
}

export type ChaseSummary = {
  /** Reminders due that the engine could not send for the vendor. */
  needsYou: number;
  /** Outstanding invoices past their due date. */
  overdue: number;
  /** Total still owed on everything in the queue. */
  owed: number;
};

/**
 * Run anything that has come due, then summarise what is left for the
 * dashboard. When auto-email is on and working, `needsYou` is the honest
 * number: the invoices the engine could NOT chase — no client email, auto-send
 * switched off, or reminders paused on a still-overdue bill. Counting every
 * due step here would show a figure that the engine had already cleared.
 */
export async function chaseSummary(
  db: DB,
  organizationId: string,
  baseUrl: string,
  now: Date = new Date(),
): Promise<ChaseSummary> {
  await runDueReminders(db, organizationId, baseUrl, now);

  const { rows } = await loadChaseQueue(db, organizationId, now);
  return {
    needsYou: rows.filter((r) => r.step !== null || (r.blocked !== null && r.daysOverdue > 0)).length,
    overdue: rows.filter((r) => r.daysOverdue > 0).length,
    owed: rows.reduce((s, r) => s + r.balanceDue, 0),
  };
}

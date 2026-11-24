export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireOrg, getOrg } from "@/server/org";
import { getDb } from "@/server/db";
import { appBaseUrl } from "@/server/config";
import { fmtDate } from "@/server/queries";
import { platformResendConfig } from "@/server/platform";
import { loadChaseQueue, runDueReminders } from "@/server/reminder-queue";
import { PageHeader, EmptyState } from "@/components/page-header";
import { ChaseQueueView, type QueueRow } from "@/components/chase-queue-view";

export const metadata = { title: "Payment reminders" };

export default async function RemindersPage() {
  const { db, organizationId } = await requireOrg();
  const baseUrl = await appBaseUrl();

  // Send anything that has come due since the last visit, then load the queue
  // so the page reflects the sends it just made.
  await runDueReminders(db, organizationId, baseUrl);

  const [{ rows, settings }, org, mail] = await Promise.all([
    loadChaseQueue(db, organizationId),
    getOrg(db, organizationId),
    platformResendConfig(await getDb()),
  ]);

  const queue: QueueRow[] = rows.map((r) => ({
    id: r.id,
    number: r.number,
    clientId: r.clientId,
    clientName: r.clientName,
    clientEmail: r.clientEmail,
    clientPhone: r.clientPhone,
    currency: r.currency,
    balanceDue: r.balanceDue,
    dueDateText: r.dueDateText,
    daysOverdue: r.daysOverdue,
    step: r.step,
    tone: r.tone,
    sentCount: r.sentSteps.length,
    lastRemindedText: r.lastRemindedAt ? fmtDate(r.lastRemindedAt) : null,
    lastFailed: r.lastFailed,
    shareToken: r.shareToken,
    remindersPaused: r.remindersPaused,
    blocked: r.blocked,
  }));

  const scheduleText = settings.schedule
    .map((s) => (s < 0 ? `${-s}d before` : s === 0 ? "on the day" : `${s}d after`))
    .join(" · ");

  return (
    <div>
      <PageHeader
        title="Payment reminders"
        subtitle="Everything you're owed, and whose turn it is to be chased."
      />

      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {settings.enabled ? "Reminders are on" : "Reminders are off"}
            {settings.enabled && !settings.autoEmail && " (manual only)"}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {settings.enabled && settings.schedule.length > 0
              ? `Schedule: ${scheduleText} · ${settings.tone} tone`
              : "Turn them on in settings to have TallyPay chase unpaid invoices for you."}
          </p>
        </div>
        <Link href="/settings#reminders" className="btn-ghost btn-sm shrink-0">
          Reminder settings
        </Link>
      </div>

      {queue.length === 0 ? (
        <EmptyState
          title="Nothing outstanding"
          body="Every invoice you've sent is paid up. When one goes unpaid it shows up here, with the reminder TallyPay will send and when."
          action={{ href: "/invoices", label: "View invoices" }}
        />
      ) : (
        <ChaseQueueView
          rows={queue}
          emailReady={Boolean(mail)}
          businessName={org?.name ?? "Your business"}
        />
      )}
    </div>
  );
}

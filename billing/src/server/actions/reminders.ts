"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { appBaseUrl } from "@/server/config";
import { parseAmount } from "@/server/money";
import { parseSchedule, daysBetween, type Tone } from "@/server/reminders";
import { recordManualChase, sendReminderEmail, reminderSettings } from "@/server/reminder-queue";

export type FormState = { error?: string; ok?: string };

const TONES = ["friendly", "firm", "final"];

/** Send one reminder email now, whatever the schedule says. */
export async function sendReminderNowAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const invoiceId = String(fd.get("invoiceId") ?? "").trim();
  if (!invoiceId) return;

  // Derive the step from the invoice's own age so the wording matches reality
  // (a manual chase on a 9-day-late invoice should say nine days).
  const rows = await db
    .select({ dueDate: schema.invoice.dueDate })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, invoiceId), eq(schema.invoice.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]?.dueDate) return;

  const step = daysBetween(rows[0].dueDate as Date, new Date());
  const settings = await reminderSettings(db, organizationId);
  const res = await sendReminderEmail(db, {
    organizationId,
    invoiceId,
    step,
    baseUrl: await appBaseUrl(),
    tone: settings.tone,
    force: true, // a human asked for this one; don't let the claim block it
  });

  revalidatePath("/reminders");
  revalidatePath(`/invoices/${invoiceId}`);
  if (!res.ok) console.error("sendReminderNowAction failed", invoiceId, res.error);
}

/** Log a chase the vendor made themselves — WhatsApp, SMS or a phone call. */
export async function markChasedAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const invoiceId = String(fd.get("invoiceId") ?? "").trim();
  const channelRaw = String(fd.get("channel") ?? "whatsapp");
  const channel = ["whatsapp", "sms", "manual", "email"].includes(channelRaw) ? channelRaw : "manual";
  if (!invoiceId) return;

  const rows = await db
    .select({ dueDate: schema.invoice.dueDate })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.id, invoiceId), eq(schema.invoice.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]?.dueDate) return;

  const settings = await reminderSettings(db, organizationId);
  await recordManualChase(db, {
    organizationId,
    invoiceId,
    step: daysBetween(rows[0].dueDate as Date, new Date()),
    channel,
    tone: settings.tone,
    detail: channel === "whatsapp" ? "Sent on WhatsApp" : null,
  });

  revalidatePath("/reminders");
  revalidatePath(`/invoices/${invoiceId}`);
}

/** Stop (or resume) chasing one invoice, without touching the client. */
export async function setInvoiceRemindersAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const invoiceId = String(fd.get("invoiceId") ?? "").trim();
  const paused = String(fd.get("paused") ?? "") === "1";
  if (!invoiceId) return;

  await db
    .update(schema.invoice)
    .set({ remindersPaused: paused })
    .where(and(eq(schema.invoice.id, invoiceId), eq(schema.invoice.organizationId, organizationId)));

  revalidatePath("/reminders");
  revalidatePath(`/invoices/${invoiceId}`);
}

/** Opt a client out of reminders entirely (or back in). */
export async function setClientRemindersAction(fd: FormData): Promise<void> {
  const { db, organizationId } = await requireOrg();
  const clientId = String(fd.get("clientId") ?? "").trim();
  const optOut = String(fd.get("optOut") ?? "") === "1";
  if (!clientId) return;

  await db
    .update(schema.client)
    .set({ remindersOptOut: optOut })
    .where(and(eq(schema.client.id, clientId), eq(schema.client.organizationId, organizationId)));

  revalidatePath("/reminders");
  revalidatePath(`/clients/${clientId}`);
}

/** Save the org's reminder schedule and tone. */
export async function saveReminderSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, organizationId } = await requireOrg();

  const enabled = fd.get("remindersEnabled") === "on";
  const autoEmail = fd.get("reminderAutoEmail") === "on";
  const toneRaw = String(fd.get("reminderTone") ?? "friendly");
  const tone = (TONES.includes(toneRaw) ? toneRaw : "friendly") as Tone;

  const scheduleRaw = String(fd.get("reminderSchedule") ?? "");
  const schedule = parseSchedule(scheduleRaw);
  if (enabled && schedule.length === 0) {
    return { error: "Add at least one reminder day, e.g. -3, 0, 3, 7, 14." };
  }
  if (schedule.length > 12) {
    return { error: "That's a lot of reminders — please keep it to 12 or fewer." };
  }

  const minAmount = Math.max(0, parseAmount(fd.get("reminderMinAmount") ?? "0"));

  await db
    .update(schema.orgProfile)
    .set({
      remindersEnabled: enabled,
      reminderAutoEmail: autoEmail,
      reminderTone: tone,
      reminderSchedule: schedule.join(","),
      reminderMinAmount: minAmount,
    })
    .where(eq(schema.orgProfile.organizationId, organizationId));

  revalidatePath("/settings");
  revalidatePath("/reminders");
  revalidatePath("/dashboard");
  return { ok: "Reminder settings saved." };
}

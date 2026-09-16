"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  postJournal, reverseJournal, postFromOperations, closePeriod, reopenPeriod,
  type JournalLineInput,
} from "@/lib/accounting.ts";
import { deviceFor } from "@/app/_components/device.ts";

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

/** Shillings on a form, cents in the ledger. */
function cents(formData: FormData, key: string): number {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

async function accountant() {
  const user = await requireUser();
  requirePermission(user.userId, "report.read", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function postAction(formData: FormData): Promise<void> {
  await act("/ledger?view=journals", async () => {
    const user = await accountant();
    // Four lines on the form; the ledger itself takes any number.
    const lines: JournalLineInput[] = [];
    for (const n of [1, 2, 3, 4]) {
      const account = text(formData, `account${n}`);
      if (!account) continue;
      const debit = cents(formData, `debit${n}`);
      const credit = cents(formData, `credit${n}`);
      if (debit === 0 && credit === 0) continue;
      lines.push({ accountCode: account, debitCents: debit, creditCents: credit, memo: text(formData, `memo${n}`) });
    }
    postJournal({
      facilityId: user.facilityId,
      entryDate: text(formData, "entryDate"),
      narrative: String(formData.get("narrative") ?? ""),
      lines,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function reverseAction(formData: FormData): Promise<void> {
  await act("/ledger?view=journals", async () => {
    const user = await accountant();
    reverseJournal({
      journalId: String(formData.get("journalId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function postFromOperationsAction(): Promise<void> {
  await act("/ledger", async () => {
    const user = await accountant();
    postFromOperations({ facilityId: user.facilityId, byUserId: user.userId, byUserName: user.name });
  });
}

export async function closePeriodAction(formData: FormData): Promise<void> {
  await act("/ledger?view=periods", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
    closePeriod({
      code: String(formData.get("code") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function reopenPeriodAction(formData: FormData): Promise<void> {
  await act("/ledger?view=periods", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "facility.configure", { actorName: user.name, facilityId: user.facilityId });
    reopenPeriod({
      code: String(formData.get("code") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

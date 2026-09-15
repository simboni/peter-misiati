"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission, licenceStatus } from "@/lib/access.ts";
import {
  bookPregnancy, recordAncContact, recordDelivery, closePregnancy,
  recordPncContact, recordImmunisation,
  type DeliveryMode, type BirthOutcome, type BabyInput,
} from "@/lib/maternity.ts";
import { deviceFor } from "@/app/_components/device.ts";

/** A number from a form, or undefined — never NaN, which SQLite would store as null silently. */
function num(formData: FormData, key: string): number | undefined {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

export async function bookAction(formData: FormData): Promise<void> {
  await act("/maternity", async () => {
    const user = await requireUser();
    requirePermission(user.userId, "encounter.conduct", {
      actorName: user.name,
      facilityId: user.facilityId,
    });
    bookPregnancy({
      patientMrn: String(formData.get("mrn") ?? ""),
      lmp: text(formData, "lmp"),
      eddOverride: text(formData, "eddOverride"),
      coverRef: text(formData, "coverRef"),
      gravida: num(formData, "gravida"),
      para: num(formData, "para"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function ancAction(formData: FormData): Promise<void> {
  const pregnancyId = String(formData.get("pregnancyId") ?? "");
  await act(`/maternity?p=${pregnancyId}`, async () => {
    const user = await requireUser();
    requirePermission(user.userId, "encounter.conduct", {
      actorName: user.name,
      facilityId: user.facilityId,
    });
    recordAncContact({
      pregnancyId,
      contactDate: text(formData, "contactDate"),
      weightGrams: num(formData, "weightKg") === undefined ? undefined : Math.round(num(formData, "weightKg")! * 1000),
      systolic: num(formData, "systolic"),
      diastolic: num(formData, "diastolic"),
      fundalHeightCm: num(formData, "fundalHeightCm"),
      haemoglobin: num(formData, "haemoglobin"),
      ttGiven: formData.get("ttGiven") === "on",
      iptpGiven: formData.get("iptpGiven") === "on",
      ironGiven: formData.get("ironGiven") === "on",
      llinGiven: formData.get("llinGiven") === "on",
      hivTested: formData.get("hivTested") === "on",
      dangerSigns: text(formData, "dangerSigns"),
      nextDue: text(formData, "nextDue"),
      note: text(formData, "note"),
      facilityId: user.facilityId,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function deliveryAction(formData: FormData): Promise<void> {
  const pregnancyId = String(formData.get("pregnancyId") ?? "");
  await act(`/maternity?view=births&p=${pregnancyId}`, async () => {
    const user = await requireUser();
    requirePermission(user.userId, "encounter.conduct", {
      actorName: user.name,
      facilityId: user.facilityId,
    });

    // Up to three babies on the form. A fourth is rarer than the form is worth;
    // the module itself takes any number.
    const babies: BabyInput[] = [];
    for (const n of [1, 2, 3]) {
      const outcome = text(formData, `outcome${n}`) as BirthOutcome | undefined;
      if (!outcome) continue;
      babies.push({
        sex: (text(formData, `sex${n}`) ?? "unknown") as BabyInput["sex"],
        birthWeightGrams: num(formData, `weight${n}`),
        apgar1: num(formData, `apgar1_${n}`),
        apgar5: num(formData, `apgar5_${n}`),
        outcome,
        givenName: text(formData, `givenName${n}`),
      });
    }

    recordDelivery({
      pregnancyId,
      mode: (text(formData, "mode") ?? "spontaneous_vertex") as DeliveryMode,
      place: (text(formData, "place") ?? "facility") as "facility" | "home" | "in_transit" | "other",
      bloodLossMl: num(formData, "bloodLossMl"),
      complications: text(formData, "complications"),
      motherOutcome: (text(formData, "motherOutcome") ?? "alive") as "alive" | "died",
      babies,
      facilityId: user.facilityId,
      byUserId: user.userId!,
      byUserName: user.name,
      // Who attended, by their regulator number: a delivery record that cannot
      // name a licensed attendant is not a birth notification.
      attendantLicence: licenceStatus(user.userId).number ?? null,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function closeAction(formData: FormData): Promise<void> {
  await act("/maternity", async () => {
    const user = await requireUser();
    closePregnancy({
      pregnancyId: String(formData.get("pregnancyId") ?? ""),
      status: String(formData.get("status") ?? "lost") as "miscarried" | "terminated" | "transferred" | "lost",
      note: String(formData.get("note") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function pncAction(formData: FormData): Promise<void> {
  const deliveryId = String(formData.get("deliveryId") ?? "");
  await act(`/maternity?view=postnatal&d=${deliveryId}`, async () => {
    const user = await requireUser();
    recordPncContact({
      deliveryId,
      scheduledAt: String(formData.get("scheduledAt") ?? ""),
      contactDate: text(formData, "contactDate"),
      motherFindings: text(formData, "motherFindings"),
      babyFindings: text(formData, "babyFindings"),
      dangerSigns: text(formData, "dangerSigns"),
      nextDue: text(formData, "nextDue"),
      facilityId: user.facilityId,
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function immuniseAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("mrn") ?? "");
  await act(`/maternity?view=immunisation&child=${mrn}`, async () => {
    const user = await requireUser();
    recordImmunisation({
      patientMrn: mrn,
      vaccineCode: String(formData.get("vaccineCode") ?? ""),
      givenOn: text(formData, "givenOn"),
      batchNumber: text(formData, "batchNumber"),
      site: text(formData, "site"),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

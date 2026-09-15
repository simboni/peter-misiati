"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { admit, transfer, recordObservation, discharge, billBedNights, type DischargeType } from "@/lib/inpatient.ts";
import { openEncounterFor, openEncounter } from "@/lib/encounters.ts";
import { deviceFor } from "@/app/_components/device.ts";

export async function admitAction(formData: FormData): Promise<void> {
  await act("/ward", async () => {
    const user = await requireUser();
    const mrn = String(formData.get("mrn") ?? "").trim();
    const device = deviceFor(user.deviceCode, user.facilityId);

    // A patient with no open consultation is admitted into a new inpatient
    // encounter: an admission is an encounter with a bed, and it must have one.
    const encounter =
      openEncounterFor(mrn)?.id ??
      openEncounter({
        facilityId: user.facilityId,
        patientMrn: mrn,
        kind: "inpatient",
        clinicianId: user.userId,
        clinicianName: user.name,
        deviceCode: device,
      });

    admit({
      encounterId: encounter,
      wardCode: String(formData.get("wardCode") ?? ""),
      bedCode: String(formData.get("bedCode") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: device,
    });
  });
}

export async function transferAction(formData: FormData): Promise<void> {
  await act("/ward", async () => {
    const user = await requireUser();
    transfer({
      admissionId: String(formData.get("admissionId") ?? ""),
      toBedCode: String(formData.get("toBedCode") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function observationAction(formData: FormData): Promise<void> {
  await act("/ward", async () => {
    const user = await requireUser();
    const num = (key: string) => {
      const raw = String(formData.get(key) ?? "").trim();
      return raw === "" ? undefined : Number(raw);
    };

    recordObservation({
      admissionId: String(formData.get("admissionId") ?? ""),
      observation: {
        temp: num("temp"),
        systolic: num("systolic"),
        diastolic: num("diastolic"),
        pulse: num("pulse"),
        respRate: num("respRate"),
        spo2: num("spo2"),
      },
      note: String(formData.get("note") ?? "").trim() || undefined,
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

export async function dischargeAction(formData: FormData): Promise<void> {
  await act("/ward", async () => {
    const user = await requireUser();
    discharge({
      admissionId: String(formData.get("admissionId") ?? ""),
      type: String(formData.get("type") ?? "home") as DischargeType,
      summary: String(formData.get("summary") ?? ""),
      byUserId: user.userId,
      byUserName: user.name,
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
    });
  });
}

export async function billNightsAction(formData: FormData): Promise<void> {
  await act("/ward", async () => {
    const user = await requireUser();
    billBedNights({
      facilityId: user.facilityId,
      payerCode: String(formData.get("payerCode") ?? "CASH"),
      deviceCode: deviceFor(user.deviceCode, user.facilityId),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

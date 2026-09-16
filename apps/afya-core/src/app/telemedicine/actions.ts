"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import {
  startSession, endSession,
  type Channel, type IdentityMethod, type Outcome, type Quality,
} from "@/lib/telemedicine.ts";
import { openEncounter, openEncounterFor } from "@/lib/encounters.ts";
import { deviceFor } from "@/app/_components/device.ts";

function text(formData: FormData, key: string): string | undefined {
  return String(formData.get(key) ?? "").trim() || undefined;
}

/** Conducting a consultation is licence-gated, remote or not. */
async function clinician() {
  const user = await requireUser();
  requirePermission(user.userId, "encounter.conduct", { actorName: user.name, facilityId: user.facilityId });
  return user;
}

export async function startAction(formData: FormData): Promise<void> {
  const mrn = String(formData.get("patientMrn") ?? "");
  await act("/telemedicine", async () => {
    const user = await clinician();
    const device = deviceFor(user.deviceCode, user.facilityId);

    // The encounter comes first, with its own licence check and its own refusal
    // for a second open consultation. Nothing about being remote changes that.
    const encounterId =
      openEncounterFor(mrn)?.id ??
      openEncounter({
        facilityId: user.facilityId,
        patientMrn: mrn,
        kind: "outpatient",
        clinicianId: user.userId,
        clinicianName: user.name,
        deviceCode: device,
      });

    startSession({
      encounterId,
      channel: (text(formData, "channel") ?? "video") as Channel,
      identityMethod: (text(formData, "identityMethod") ?? "portal_code") as IdentityMethod,
      identityNote: text(formData, "identityNote"),
      platform: text(formData, "platform"),
      consentBy: text(formData, "consentBy"),
      reason: text(formData, "reason"),
      clinicianId: user.userId,
      clinicianName: user.name,
      deviceCode: device,
    });
  });
}

export async function endAction(formData: FormData): Promise<void> {
  await act("/telemedicine", async () => {
    const user = await clinician();
    endSession({
      sessionId: String(formData.get("sessionId") ?? ""),
      outcome: (text(formData, "outcome") ?? "completed") as Outcome,
      quality: (text(formData, "quality") ?? "good") as Quality,
      note: text(formData, "note"),
      redFlagAction: text(formData, "redFlagAction"),
      byUserId: user.userId,
      byUserName: user.name,
    });
  });
}

"use server";

/**
 * Patient registration and search.
 *
 * The important behaviour here is what registration does when it finds a likely
 * duplicate: it stops and shows them, rather than creating the record or merging
 * anything. A person decides. That is the whole of weakness W6 — an automatic
 * merge on a score is how two patients become one record.
 */

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import { activeDevice, listDevices } from "@/lib/facility.ts";
import { findCandidates, registerPatient, LIKELY_MATCH, type Sex, type Candidate } from "@/lib/patients.ts";

export type RegisterState = {
  error?: string;
  /** Present when registration paused to ask about possible duplicates. */
  candidates?: { mrn: string; name: string; detail: string; score: number; reasons: string[] }[];
  /** Echoed back so the form keeps what was typed. */
  values?: Record<string, string>;
};

/**
 * The device this session is writing from.
 *
 * Every identifier minted offline carries a device prefix, so a facility with no
 * registered device cannot register a patient — by design. The message says what
 * to do rather than failing obscurely.
 */
async function deviceForSession(sessionDevice: string | null, facilityId: number): Promise<string> {
  if (sessionDevice && activeDevice(sessionDevice)) return sessionDevice;

  const devices = listDevices(facilityId).filter((d) => !d.revoked_at);
  if (devices.length === 0) {
    throw new Error(
      "No device is registered for this facility. An administrator must register one before patients can be recorded — every file number carries its device's prefix so two offline tablets cannot issue the same number.",
    );
  }
  return devices[0].code;
}

export async function registerPatientAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const user = await requireUser();

  const values = Object.fromEntries(
    ["givenName", "familyName", "sex", "dateOfBirth", "nationalId", "shaNumber", "phone", "county", "village"].map(
      (k) => [k, String(formData.get(k) ?? "").trim()],
    ),
  );
  const dobEstimated = formData.get("dobEstimated") === "on";
  if (dobEstimated) values.dobEstimated = "on";
  const confirmedNew = formData.get("confirmNew") === "yes";

  try {
    requirePermission(user.userId, "patient.register", {
      actorName: user.name,
      facilityId: user.facilityId,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Not permitted.", values };
  }

  if (!values.givenName || !values.familyName) {
    return { error: "Both a given name and a family name are required.", values };
  }
  if (!values.sex) {
    return { error: "Sex is required.", values };
  }

  // Look before creating — unless the user has already seen the candidates and
  // said this is somebody new.
  if (!confirmedNew) {
    const candidates: Candidate[] = findCandidates({
      facilityId: user.facilityId,
      nationalId: values.nationalId || null,
      shaNumber: values.shaNumber || null,
      givenName: values.givenName,
      familyName: values.familyName,
      sex: (values.sex as Sex) || undefined,
      dateOfBirth: values.dateOfBirth || null,
      phone: values.phone || null,
      county: values.county,
      village: values.village,
    });

    const likely = candidates.filter((c) => c.definite || c.score >= LIKELY_MATCH);
    if (likely.length > 0) {
      return {
        values,
        candidates: likely.map((c) => ({
          mrn: c.patient.mrn,
          name: `${c.patient.given_name} ${c.patient.family_name}`,
          detail: [
            c.patient.date_of_birth ? `b. ${c.patient.date_of_birth}${c.patient.dob_estimated ? " (est.)" : ""}` : null,
            c.patient.phone,
            c.patient.village || c.patient.county,
          ]
            .filter(Boolean)
            .join(" · "),
          score: c.score,
          reasons: c.reasons,
        })),
      };
    }
  }

  let mrn: string;
  try {
    const deviceCode = await deviceForSession(user.deviceCode, user.facilityId);
    mrn = registerPatient({
      facilityId: user.facilityId,
      deviceCode,
      givenName: values.givenName,
      familyName: values.familyName,
      sex: values.sex as Sex,
      dateOfBirth: values.dateOfBirth || null,
      dobEstimated,
      nationalId: values.nationalId || null,
      shaNumber: values.shaNumber || null,
      phone: values.phone || null,
      county: values.county,
      village: values.village,
      byUserId: user.userId,
      byUserName: user.name,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not register the patient.", values };
  }

  redirect(`/patients/${encodeURIComponent(mrn)}`);
}

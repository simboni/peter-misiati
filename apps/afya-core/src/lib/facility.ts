/**
 * M00 Platform Core — the facility, its configuration and its devices.
 *
 * A facility is not just a name on a letterhead. It is four identifiers, each
 * belonging to a different authority, and a claim, a tax invoice or an MOH
 * return is rejected if the wrong one is missing:
 *
 *   KMHFL code          MOH — identifies the facility on every national return
 *   SHA provider code   SHA — every claim is submitted under it
 *   KRA PIN             KRA — every eTIMS tax invoice is issued under it
 *   ODPC registration   ODPC — the facility's own data-controller registration
 *
 * The ODPC expiry is tracked here because it lapses silently. A facility whose
 * registration has run out is non-compliant no matter how good its software is,
 * and nobody notices until an inspection.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { assertDeviceCode } from "./ids.ts";

export interface Facility {
  id: number;
  name: string;
  kmhfl_code: string;
  sha_provider_code: string | null;
  kra_pin: string | null;
  level: number;
  county: string;
  odpc_registration: string | null;
  odpc_expires_on: string | null;
  active: number;
  created_at: string;
}

export interface Device {
  id: number;
  facility_id: number;
  code: string;
  label: string;
  revoked_at: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export class FacilityError extends Error {}

// ------------------------------------------------------------------ facility

/** MOH facility levels, as used on the Kenya Master Health Facility List. */
export const LEVELS: Record<number, string> = {
  2: "Dispensary / clinic",
  3: "Health centre / nursing home",
  4: "Primary hospital",
  5: "Secondary / county referral hospital",
  6: "Tertiary / national referral hospital",
};

export function registerFacility(input: {
  name: string;
  kmhflCode: string;
  level: number;
  county?: string;
  shaProviderCode?: string;
  kraPin?: string;
  byUserId?: number | null;
  byUserName?: string;
}): number {
  const name = input.name.trim();
  const kmhfl = input.kmhflCode.trim().toUpperCase();

  if (!name) throw new FacilityError("facility name is required");
  if (!kmhfl) throw new FacilityError("KMHFL code is required — MOH returns are rejected without it");
  if (!LEVELS[input.level]) {
    throw new FacilityError(`level must be 2-6 (got ${input.level})`);
  }
  if (get<{ id: number }>(`SELECT id FROM facilities WHERE kmhfl_code = ?`, kmhfl)) {
    throw new FacilityError(`a facility with KMHFL code ${kmhfl} is already registered`);
  }

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO facilities
         (name, kmhfl_code, sha_provider_code, kra_pin, level, county, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      name,
      kmhfl,
      input.shaProviderCode?.trim() || null,
      input.kraPin?.trim().toUpperCase() || null,
      input.level,
      input.county?.trim() ?? "",
      now(),
    );
    audit({
      action: "facility_registered",
      entity: "facility",
      entityId: lastInsertRowid,
      facilityId: lastInsertRowid,
      actorId: input.byUserId ?? null,
      actorName: input.byUserName ?? "system",
      purpose: "administration",
      detail: { name, kmhfl, level: input.level },
    });
    return lastInsertRowid;
  });
}

export function getFacility(id: number): Facility | undefined {
  return get<Facility>(`SELECT * FROM facilities WHERE id = ?`, id);
}

export function listFacilities(): Facility[] {
  return all<Facility>(`SELECT * FROM facilities ORDER BY name`);
}

/**
 * Record the facility's own ODPC data-controller registration.
 *
 * Certificates run 24 months. We store the expiry so the compliance dashboard
 * can warn before it lapses rather than after.
 */
export function setOdpcRegistration(input: {
  facilityId: number;
  registration: string;
  expiresOn: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn)) {
    throw new FacilityError("ODPC expiry must be an ISO date (YYYY-MM-DD)");
  }
  tx(() => {
    const changed = run(
      `UPDATE facilities SET odpc_registration = ?, odpc_expires_on = ? WHERE id = ?`,
      input.registration.trim(),
      input.expiresOn,
      input.facilityId,
    ).changes;
    if (!changed) throw new FacilityError("no such facility");
    audit({
      action: "odpc_registration_set",
      entity: "facility",
      entityId: input.facilityId,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { registration: input.registration, expiresOn: input.expiresOn },
    });
  });
}

export type ComplianceFlag = {
  key: string;
  severity: "ok" | "warning" | "critical";
  message: string;
};

/**
 * The facility-level half of the compliance dashboard.
 *
 * Deliberately blunt: a missing SHA provider code is `critical`, because every
 * claim the facility submits will fail without it, and "warning" is the tone
 * that gets ignored.
 */
export function facilityCompliance(facilityId: number, asOf = today()): ComplianceFlag[] {
  const f = getFacility(facilityId);
  if (!f) throw new FacilityError("no such facility");

  const flags: ComplianceFlag[] = [];

  if (!f.sha_provider_code) {
    flags.push({
      key: "sha_provider_code",
      severity: "critical",
      message: "No SHA provider code. Claims cannot be submitted until it is set.",
    });
  }
  if (!f.kra_pin) {
    flags.push({
      key: "kra_pin",
      severity: "critical",
      message: "No KRA PIN. eTIMS invoices cannot be issued, and every encounter needs one.",
    });
  }
  if (!f.odpc_registration) {
    flags.push({
      key: "odpc_registration",
      severity: "critical",
      message: "Not registered with the ODPC as a data controller.",
    });
  } else if (f.odpc_expires_on) {
    const daysLeft = daysBetween(asOf, f.odpc_expires_on);
    if (daysLeft < 0) {
      flags.push({
        key: "odpc_registration",
        severity: "critical",
        message: `ODPC registration expired on ${f.odpc_expires_on}.`,
      });
    } else if (daysLeft <= 60) {
      flags.push({
        key: "odpc_registration",
        severity: "warning",
        message: `ODPC registration expires in ${daysLeft} days (${f.odpc_expires_on}).`,
      });
    }
  }

  return flags;
}

/** Whole days from `from` to `to`, both ISO dates. Negative when `to` is past. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

// ------------------------------------------------------------------ settings

export function setSetting(key: string, value: string, by?: { userId: number; name: string }): void {
  tx(() => {
    run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      now(),
    );
    audit({
      action: "setting_changed",
      entity: "setting",
      entityId: key,
      actorId: by?.userId ?? null,
      actorName: by?.name ?? "system",
      purpose: "administration",
      detail: { key, value },
    });
  });
}

export function getSetting(key: string, fallback = ""): string {
  return get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, key)?.value ?? fallback;
}

export function getSettingNumber(key: string, fallback: number): number {
  const raw = getSetting(key, "");
  const n = Number(raw);
  return raw === "" || Number.isNaN(n) ? fallback : n;
}

// ------------------------------------------------------------------- devices

/**
 * Register a device that may hold facility data offline.
 *
 * The code becomes the prefix on every identifier this device mints while
 * disconnected, which is why it must be unique across the whole deployment and
 * why it cannot be changed afterwards — identifiers already on paper carry it.
 */
export function registerDevice(input: {
  facilityId: number;
  code: string;
  label: string;
  byUserId: number | null;
  byUserName: string;
}): number {
  const code = input.code.trim().toUpperCase();
  assertDeviceCode(code);

  if (get<{ id: number }>(`SELECT id FROM devices WHERE code = ?`, code)) {
    throw new FacilityError(`device code ${code} is already registered`);
  }

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO devices (facility_id, code, label, created_at) VALUES (?, ?, ?, ?)`,
      input.facilityId,
      code,
      input.label.trim(),
      now(),
    );
    audit({
      action: "device_registered",
      entity: "device",
      entityId: code,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { code, label: input.label },
    });
    return lastInsertRowid;
  });
}

/**
 * Revoke a device — the action an administrator takes when a tablet is lost.
 *
 * Revocation ends the device's sessions immediately. The local encrypted store
 * is wiped when the device next reaches the server, but cutting its sessions is
 * what stops it being useful in the meantime.
 */
export function revokeDevice(input: { code: string; byUserId: number | null; byUserName: string; reason: string }): void {
  const code = input.code.trim().toUpperCase();
  const device = get<Device>(`SELECT * FROM devices WHERE code = ?`, code);
  if (!device) throw new FacilityError("no such device");
  if (device.revoked_at) throw new FacilityError(`device ${code} is already revoked`);

  tx(() => {
    const at = now();
    run(`UPDATE devices SET revoked_at = ? WHERE code = ?`, at, code);
    run(`UPDATE sessions SET ended_at = ? WHERE device_code = ? AND ended_at IS NULL`, at, code);
    audit({
      action: "device_revoked",
      entity: "device",
      entityId: code,
      facilityId: device.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { code, reason: input.reason },
    });
  });
}

export function listDevices(facilityId: number): Device[] {
  return all<Device>(`SELECT * FROM devices WHERE facility_id = ? ORDER BY code`, facilityId);
}

export function activeDevice(code: string): Device | undefined {
  return get<Device>(`SELECT * FROM devices WHERE code = ? AND revoked_at IS NULL`, code.toUpperCase());
}

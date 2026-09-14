/**
 * Seed data — cadres, the permission catalogue, and the default roles.
 *
 * This file is where several compliance rules actually live. `requiresLicence`
 * on a permission is the Health Act / council-registration rule expressed as
 * code; `requiresMfa` is the Data Protection Act's security-safeguards
 * obligation applied to the accounts that can do the most damage.
 *
 * Permissions are named for what a person does, not for a table they touch, so
 * an administrator assigning roles can reason about them without knowing the
 * schema.
 *
 * Idempotent: safe to run against an existing database on upgrade.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { get, run, tx, audit } from "./db.ts";
import { definePermission, defineRole } from "./access.ts";
import { registerFacility, registerDevice, setSetting } from "./facility.ts";
import { createUser, recordLicence } from "./users.ts";

/** The councils that license clinical practice in Kenya. */
export const CADRES: { code: string; name: string; regulator: string; licensed: boolean }[] = [
  { code: "medical_officer", name: "Medical Officer", regulator: "KMPDC", licensed: true },
  { code: "specialist", name: "Specialist / Consultant", regulator: "KMPDC", licensed: true },
  { code: "clinical_officer", name: "Clinical Officer", regulator: "COC", licensed: true },
  { code: "nurse", name: "Nurse", regulator: "NCK", licensed: true },
  { code: "pharmacist", name: "Pharmacist", regulator: "PPB", licensed: true },
  { code: "pharm_tech", name: "Pharmaceutical Technologist", regulator: "PPB", licensed: true },
  { code: "lab_technologist", name: "Laboratory Technologist", regulator: "KMLTTB", licensed: true },
  { code: "radiographer", name: "Radiographer", regulator: "SRTB", licensed: true },
  { code: "nutritionist", name: "Nutritionist", regulator: "KNDI", licensed: true },
  // Non-clinical staff hold no licence and can hold no licence-gated permission.
  { code: "administrative", name: "Administrative / Support", regulator: "none", licensed: false },
];

interface PermSpec {
  code: string;
  description: string;
  licence?: boolean;
  mfa?: boolean;
}

/**
 * The permission catalogue.
 *
 * `licence: true` means an expired council registration switches it off — these
 * are the acts a claim cites and a regulator can ask about.
 * `mfa: true` means the account must carry a second factor — money, controlled
 * drugs, claims, and anything that can change who else has access.
 */
export const PERMISSIONS: PermSpec[] = [
  // Patient & front office
  { code: "patient.register", description: "Register a new patient" },
  { code: "patient.read", description: "Open a patient record" },
  { code: "patient.amend", description: "Correct patient demographics" },
  { code: "patient.merge", description: "Merge duplicate patient records", mfa: true },
  { code: "queue.manage", description: "Check patients in and manage the queue" },
  { code: "triage.record", description: "Record triage vitals and priority" },

  // Clinical — every one of these is an act a council licenses
  { code: "encounter.conduct", description: "Conduct and document a consultation", licence: true },
  { code: "diagnosis.code", description: "Assign a coded diagnosis", licence: true },
  { code: "prescription.write", description: "Prescribe medication", licence: true },
  { code: "order.place", description: "Order laboratory or imaging investigations", licence: true },
  { code: "patient.admit", description: "Admit a patient", licence: true },
  { code: "patient.discharge", description: "Discharge a patient and sign the summary", licence: true },
  { code: "dispense.perform", description: "Dispense medication", licence: true },
  { code: "dispense.controlled", description: "Dispense a controlled substance", licence: true, mfa: true },
  { code: "lab.result.release", description: "Validate and release a laboratory result", licence: true },

  // Revenue cycle
  { code: "billing.charge", description: "Raise charges and invoices" },
  { code: "payment.receive", description: "Receive a payment and issue a receipt" },
  { code: "payment.refund", description: "Refund a payment or issue a credit note", mfa: true },
  { code: "tariff.manage", description: "Change tariffs and price lists", mfa: true },
  { code: "coverage.verify", description: "Verify a patient's payer coverage" },
  { code: "preauth.request", description: "Request pre-authorisation from a payer" },
  { code: "claim.prepare", description: "Assemble and scrub a claim" },
  { code: "claim.submit", description: "Submit a claim to a payer", mfa: true },

  // Platform & compliance
  { code: "user.manage", description: "Create and administer user accounts", mfa: true },
  { code: "role.manage", description: "Define roles and permissions", mfa: true },
  { code: "device.manage", description: "Register and revoke devices", mfa: true },
  { code: "facility.configure", description: "Change facility settings and identifiers", mfa: true },
  { code: "audit.read", description: "Read the audit log and export the audit pack", mfa: true },
  { code: "report.read", description: "View reports and dashboards" },
];

/**
 * Default roles.
 *
 * Shaped around who actually stands where in a Kenyan facility rather than
 * around the module list — a receptionist does registration, queue and cash; a
 * clinical officer does the whole consultation; the claims officer is a distinct
 * person because that is how a facility that gets paid is staffed.
 */
export const ROLES: { code: string; name: string; description: string; permissions: string[] }[] = [
  {
    code: "administrator",
    name: "Facility Administrator",
    description: "Configures the facility, its users and its devices.",
    permissions: [
      "user.manage", "role.manage", "device.manage", "facility.configure",
      "audit.read", "report.read", "tariff.manage", "patient.merge",
    ],
  },
  {
    code: "receptionist",
    name: "Receptionist / Records Clerk",
    description: "Registers patients, runs the queue, takes payment.",
    permissions: [
      "patient.register", "patient.read", "patient.amend", "queue.manage",
      "coverage.verify", "billing.charge", "payment.receive",
    ],
  },
  {
    code: "triage_nurse",
    name: "Triage Nurse",
    description: "Takes vitals and sets queue priority.",
    permissions: ["patient.read", "queue.manage", "triage.record"],
  },
  {
    code: "clinician",
    name: "Clinician",
    description: "Consults, diagnoses, prescribes, orders, admits and discharges.",
    permissions: [
      "patient.read", "encounter.conduct", "diagnosis.code", "prescription.write",
      "order.place", "patient.admit", "patient.discharge", "preauth.request", "report.read",
    ],
  },
  {
    code: "nurse",
    name: "Ward Nurse",
    description: "Records observations and administers medication on the ward.",
    permissions: ["patient.read", "triage.record", "encounter.conduct"],
  },
  {
    code: "pharmacist",
    name: "Pharmacist",
    description: "Dispenses, including controlled substances.",
    permissions: ["patient.read", "dispense.perform", "dispense.controlled", "billing.charge", "report.read"],
  },
  {
    code: "lab_technologist",
    name: "Laboratory Technologist",
    description: "Processes specimens and releases results.",
    permissions: ["patient.read", "lab.result.release", "billing.charge"],
  },
  {
    code: "cashier",
    name: "Cashier",
    description: "Takes payment and issues receipts.",
    permissions: ["patient.read", "billing.charge", "payment.receive", "payment.refund"],
  },
  {
    code: "claims_officer",
    name: "Claims Officer",
    description: "Verifies coverage, chases pre-authorisation, prepares and submits claims.",
    permissions: [
      "patient.read", "coverage.verify", "preauth.request", "claim.prepare",
      "claim.submit", "billing.charge", "report.read",
    ],
  },
];

/** Install cadres, permissions and roles. Idempotent. */
export function seedReferenceData(): void {
  tx(() => {
    for (const c of CADRES) {
      run(
        `INSERT INTO cadres (code, name, regulator, licensed) VALUES (?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, regulator = excluded.regulator, licensed = excluded.licensed`,
        c.code,
        c.name,
        c.regulator,
        c.licensed ? 1 : 0,
      );
    }
  });

  for (const p of PERMISSIONS) {
    definePermission({
      code: p.code,
      description: p.description,
      requiresLicence: p.licence,
      requiresMfa: p.mfa,
    });
  }

  for (const r of ROLES) {
    defineRole({ ...r, system: true, byUserName: "system" });
  }
}

/**
 * A demonstration facility with staff — used by tests, the seed script and a
 * sales demonstration. Every account ships needing a password change.
 */
export function seedDemo(): { facilityId: number; adminId: number; clinicianId: number; receptionistId: number } {
  seedReferenceData();

  const existing = get<{ id: number }>(`SELECT id FROM facilities WHERE kmhfl_code = 'DEMO-0001'`);
  if (existing) {
    const admin = get<{ id: number }>(`SELECT id FROM users WHERE username = 'admin'`)!;
    const clinician = get<{ id: number }>(`SELECT id FROM users WHERE username = 'a.wanjiru'`)!;
    const reception = get<{ id: number }>(`SELECT id FROM users WHERE username = 'j.otieno'`)!;
    return {
      facilityId: existing.id,
      adminId: admin.id,
      clinicianId: clinician.id,
      receptionistId: reception.id,
    };
  }

  const facilityId = registerFacility({
    name: "Demo Medical Clinic",
    kmhflCode: "DEMO-0001",
    level: 2,
    county: "Nairobi",
  });

  setSetting("session_timeout_minutes", "30");
  setSetting("claim_submission_window_days", "7");

  const adminId = createUser({
    facilityId,
    name: "Facility Administrator",
    username: "admin",
    password: "ChangeMe123",
    cadreCode: "administrative",
    roles: ["administrator"],
    mustChangePassword: true,
    byUserName: "seed",
  });

  const clinicianId = createUser({
    facilityId,
    name: "Dr. Achieng Wanjiru",
    username: "a.wanjiru",
    password: "ChangeMe123",
    cadreCode: "medical_officer",
    roles: ["clinician"],
    mustChangePassword: true,
    byUserId: adminId,
    byUserName: "seed",
  });

  // Dated a year out so the demo works; a real licence is entered from the
  // practitioner's certificate.
  const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  recordLicence({
    userId: clinicianId,
    regulator: "KMPDC",
    licenceNumber: "KMPDC-DEMO-4471",
    expiresOn: nextYear,
    byUserId: adminId,
    byUserName: "seed",
  });

  // A facility with no registered device cannot record a patient — every file
  // number carries its device's prefix. A real clinic has at least one, so the
  // demo has one too rather than dead-ending on the first registration.
  registerDevice({
    facilityId,
    code: "REC1",
    label: "Reception desk",
    byUserId: adminId,
    byUserName: "seed",
  });

  const receptionistId = createUser({
    facilityId,
    name: "Joseph Otieno",
    username: "j.otieno",
    password: "ChangeMe123",
    cadreCode: "administrative",
    roles: ["receptionist"],
    mustChangePassword: true,
    byUserId: adminId,
    byUserName: "seed",
  });

  audit({
    action: "demo_seeded",
    entity: "facility",
    entityId: facilityId,
    facilityId,
    actorName: "seed",
    purpose: "administration",
    detail: { users: 3 },
  });

  return { facilityId, adminId, clinicianId, receptionistId };
}

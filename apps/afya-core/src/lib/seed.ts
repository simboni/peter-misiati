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
import { createUser, recordLicence, enableMfa } from "./users.ts";
import { importCodes, ICD11 } from "./terminology.ts";
import { importProducts } from "./prescribing.ts";
import { definePayer, defineBenefit } from "./payers.ts";
import { defineService, setTariff } from "./billing.ts";
import { seedEndpoints } from "./integration.ts";
import { defineStore, setReorderLevel } from "./inventory.ts";
import { defineRange } from "./laboratory.ts";
import { defineWard, defineBed } from "./inpatient.ts";
import { seedProgrammes } from "./programmes.ts";
import { seedImmunisationSchedule } from "./maternity.ts";
import { seedReferralDirectory } from "./referrals.ts";
import { seedTheatres } from "./theatre.ts";

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
      // Money going back out is an authorisation, not a till operation. A
      // cashier can refund their own mistake; this is who signs off the rest.
      "payment.refund",
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


/**
 * ICD-11 starter set.
 *
 * TEN CODES. This is not a catalogue — it is enough to run the system on day one
 * and to prove the coding path works end to end.
 *
 * Every code here was checked against the published ICD-11 MMS classification
 * and is marked `verified`. Codes that could NOT be confirmed were deliberately
 * left out rather than guessed: a wrong diagnosis code is one of the named
 * reasons SHA rejects a claim, so an invented code would cause exactly the
 * problem this system exists to prevent.
 *
 * BEFORE GO-LIVE the full WHO ICD-11 MMS release must be loaded with
 * `importCodes({ system: ICD11, source: "WHO ICD-11 MMS <release>", ... })`.
 * `coverage()` reports `starterOnly` until it is, and the compliance dashboard
 * says so, because a clinician who cannot find their diagnosis picks something
 * close instead — which is how wrong codes reach claims.
 */
export const ICD11_STARTER: { code: string; term: string; synonyms?: string }[] = [
  { code: "1F40", term: "Malaria due to Plasmodium falciparum", synonyms: "malaria,falciparum,homa ya malaria" },
  { code: "1F41", term: "Malaria due to Plasmodium vivax", synonyms: "malaria,vivax" },
  { code: "1F42", term: "Malaria due to Plasmodium malariae", synonyms: "malaria,malariae" },
  { code: "1F43", term: "Malaria due to Plasmodium ovale", synonyms: "malaria,ovale" },
  { code: "1F4Z", term: "Malaria, unspecified", synonyms: "malaria" },
  { code: "CA07", term: "Acute upper respiratory infections of multiple and unspecified sites", synonyms: "URTI,cold,flu,cough" },
  { code: "CA23", term: "Asthma", synonyms: "asthma,wheeze" },
  { code: "CA40", term: "Pneumonia", synonyms: "pneumonia,chest infection" },
  { code: "1A40", term: "Gastroenteritis or colitis without specification of infectious agent", synonyms: "gastroenteritis,diarrhoea,diarrhea,running stomach" },
  { code: "GC08", term: "Urinary tract infection, site not specified", synonyms: "UTI,urine infection" },
];


/**
 * Starter formulary.
 *
 * The essential medicines a Kenyan Level 2/3 outpatient clinic actually reaches
 * for. Like the ICD-11 starter set this is NOT the register: the PPB
 * registration numbers here are placeholders, marked as such, and the real
 * register must be loaded with `importProducts` before dispensing.
 *
 * Generic names are what matter — an allergy is to the generic, and it must
 * match whatever brand is on the shelf that week.
 */
export const FORMULARY_STARTER: {
  code: string; name: string; genericName: string; form: string; strength: string; controlled?: boolean;
}[] = [
  { code: "AL-20-120", name: "Artemether/Lumefantrine 20/120", genericName: "artemether lumefantrine", form: "tablet", strength: "20/120 mg" },
  { code: "PARA-500", name: "Paracetamol 500mg", genericName: "paracetamol", form: "tablet", strength: "500 mg" },
  { code: "AMOX-500", name: "Amoxicillin 500mg", genericName: "amoxicillin", form: "capsule", strength: "500 mg" },
  { code: "AMOX-125S", name: "Amoxicillin suspension 125mg/5ml", genericName: "amoxicillin", form: "suspension", strength: "125 mg/5 ml" },
  { code: "CTX-960", name: "Cotrimoxazole 960mg", genericName: "cotrimoxazole", form: "tablet", strength: "960 mg" },
  { code: "ORS-1L", name: "Oral Rehydration Salts", genericName: "oral rehydration salts", form: "sachet", strength: "1 L" },
  { code: "ZINC-20", name: "Zinc sulphate 20mg", genericName: "zinc sulphate", form: "tablet", strength: "20 mg" },
  { code: "SALB-INH", name: "Salbutamol inhaler", genericName: "salbutamol", form: "inhaler", strength: "100 mcg/dose" },
  { code: "METRO-400", name: "Metronidazole 400mg", genericName: "metronidazole", form: "tablet", strength: "400 mg" },
  { code: "IBU-400", name: "Ibuprofen 400mg", genericName: "ibuprofen", form: "tablet", strength: "400 mg" },
  { code: "MORPH-10", name: "Morphine sulphate 10mg", genericName: "morphine", form: "tablet", strength: "10 mg", controlled: true },
];


/**
 * Payers, services and tariffs.
 *
 * The SHA row carries the two rules that actually bite: a seven-day submission
 * window, and pre-authorisation on the services SHA requires it for. Prices are
 * INTEGER CENTS and are illustrative — the real SHA tariff schedule for the
 * contracting cycle must be loaded with `setTariff` before go-live, and every
 * tariff records its source.
 */
export function seedRevenueCycle(): void {
  definePayer({ code: "CASH", name: "Cash / self-paying", kind: "cash", byUserName: "seed" });
  definePayer({
    code: "SHA",
    name: "Social Health Authority",
    kind: "sha",
    // A claim submitted beyond seven days is rejected automatically.
    claimWindowDays: 7,
    byUserName: "seed",
  });

  const services: { code: string; name: string; category: string; etims: string }[] = [
    { code: "CONSULT-OP", name: "Outpatient consultation", category: "consultation", etims: "SRV-CONSULT" },
    { code: "CONSULT-REV", name: "Review consultation", category: "consultation", etims: "SRV-CONSULT" },
    { code: "LAB-MRDT", name: "Malaria rapid diagnostic test", category: "laboratory", etims: "SRV-LAB" },
    { code: "LAB-CBC", name: "Full haemogram", category: "laboratory", etims: "SRV-LAB" },
    { code: "LAB-URIN", name: "Urinalysis", category: "laboratory", etims: "SRV-LAB" },
    { code: "IMG-CXR", name: "Chest X-ray", category: "imaging", etims: "SRV-IMG" },
    { code: "IMG-XRAY", name: "Plain X-ray, other region", category: "imaging", etims: "SRV-IMG" },
    { code: "IMG-USS-ABD", name: "Ultrasound, abdomen", category: "imaging", etims: "SRV-IMG" },
    { code: "IMG-USS-OBS", name: "Ultrasound, obstetric", category: "imaging", etims: "SRV-IMG" },
    { code: "PROC-SUTURE", name: "Suturing, minor", category: "procedure", etims: "SRV-PROC" },
    { code: "PROC-NEB", name: "Nebulisation", category: "procedure", etims: "SRV-PROC" },
  ];
  for (const s of services) {
    defineService({ code: s.code, name: s.name, category: s.category, etimsClass: s.etims });
  }

  defineService({ code: "BED-DAY", name: "Bed day (general ward)", category: "inpatient", etimsClass: "SRV-BED" });

  // Dispensed products are billed under their own codes.
  for (const p of FORMULARY_STARTER) {
    defineService({ code: p.code, name: p.name, category: "pharmacy", etimsClass: "SRV-PHARM" });
  }

  const TARIFF_SOURCE = "illustrative starter tariff — load the SHA schedule before go-live";

  // Cash prices, in cents.
  const cash: [string, number][] = [
    ["CONSULT-OP", 50_000], ["CONSULT-REV", 30_000], ["BED-DAY", 250_000],
    ["LAB-MRDT", 20_000], ["LAB-CBC", 60_000], ["LAB-URIN", 25_000],
    ["IMG-CXR", 120_000], ["IMG-XRAY", 100_000], ["IMG-USS-ABD", 200_000], ["IMG-USS-OBS", 180_000],
    ["PROC-SUTURE", 150_000], ["PROC-NEB", 80_000],
    ["AL-20-120", 35_000], ["PARA-500", 5_00], ["AMOX-500", 12_00], ["AMOX-125S", 25_000],
    ["CTX-960", 8_00], ["ORS-1L", 5_000], ["ZINC-20", 3_00], ["SALB-INH", 90_000],
    ["METRO-400", 7_00], ["IBU-400", 6_00], ["MORPH-10", 45_000],
  ];
  for (const [code, price] of cash) {
    setTariff({ payerCode: "CASH", serviceCode: code, priceCents: price, effectiveFrom: "2020-01-01", source: TARIFF_SOURCE });
  }

  // SHA reimburses at its own rates, and covers a defined package.
  for (const [code, price] of cash) {
    setTariff({
      payerCode: "SHA",
      serviceCode: code,
      // Illustrative: SHA rates sit below cash list prices.
      priceCents: Math.round(price * 0.8),
      effectiveFrom: "2020-01-01",
      source: TARIFF_SOURCE,
    });
    defineBenefit({
      payerCode: "SHA",
      serviceCode: code,
      covered: true,
      // Minor procedures need pre-authorisation; routine outpatient care does not.
      requiresPreauth: code.startsWith("PROC-"),
      // "Missing documentation" is a named rejection cause. A laboratory line
      // claimed without its report, or a procedure without its approval letter,
      // is one the scrubber can now stop before it leaves the building.
      requiredDocuments: code.startsWith("LAB-")
        ? ["lab_report"]
        : code.startsWith("PROC-")
          ? ["preauth_letter"]
          : [],
      source: "illustrative benefit rules — load the SHA package before go-live",
    });
  }
}

/**
 * Stores and their reorder levels.
 *
 * A Level 2 clinic has two: a main store that takes delivery and a pharmacy
 * that hands medicine over. Only the pharmacy dispenses, which is the rule that
 * stops stock leaving from somewhere nobody is counting.
 */
export function seedStores(facilityId = 1): void {
  defineStore({ facilityId, code: "MAIN", name: "Main store", kind: "main" });
  defineStore({ facilityId, code: "PHARM", name: "Pharmacy", kind: "pharmacy", dispensing: true });

  // Illustrative levels. A real facility sets these from its own consumption —
  // and until it does, the reorder report says so rather than assuming zero.
  for (const p of FORMULARY_STARTER) {
    setReorderLevel({
      storeCode: "PHARM",
      productCode: p.code,
      reorderAt: p.controlled ? 10 : 50,
      reorderTo: p.controlled ? 40 : 300,
    });
  }
}

/**
 * A ward with beds, so an admission can be demonstrated.
 *
 * Small and deliberately mixed-plus-maternity: the maternity ward is what makes
 * the sex restriction visible, and the restriction is the rule that stops a bed
 * board promising a bed the patient cannot occupy.
 */
export function seedWards(facilityId = 1): void {
  defineWard({ facilityId, code: "GEN", name: "General ward", kind: "general" });
  defineWard({ facilityId, code: "MAT", name: "Maternity ward", kind: "maternity", admitsSex: "female" });

  for (let n = 1; n <= 6; n++) {
    defineBed({ wardCode: "GEN", code: `GEN-${n}`, label: `General bed ${n}` });
  }
  for (let n = 1; n <= 4; n++) {
    defineBed({ wardCode: "MAT", code: `MAT-${n}`, label: `Maternity bed ${n}` });
  }
}

/**
 * Reference ranges for the starter laboratory panel.
 *
 * Adult values from the standard clinical chemistry and haematology literature,
 * with the panic thresholds a Kenyan Level 2/3 laboratory would telephone on.
 * Like every other reference set here they carry their source, and a facility
 * running its own analyser must load the ranges that analyser was validated
 * against — a flag from somebody else's instrument is a flag nobody trusts.
 */
export function seedReferenceRanges(): void {
  const SOURCE = "starter adult reference ranges — load your analyser's validated ranges before go-live";

  // Haemoglobin differs by sex, which is exactly why ranges are data.
  defineRange({ analyte: "HB", unit: "g/dL", sex: "male", minAgeYears: 15, low: 13, high: 17, panicLow: 7, panicHigh: 20, source: SOURCE });
  defineRange({ analyte: "HB", unit: "g/dL", sex: "female", minAgeYears: 15, low: 12, high: 15, panicLow: 7, panicHigh: 20, source: SOURCE });
  defineRange({ analyte: "HB", unit: "g/dL", minAgeYears: 0, maxAgeYears: 14, low: 11, high: 14, panicLow: 6, panicHigh: 20, source: SOURCE });

  defineRange({ analyte: "WBC", unit: "x10^9/L", low: 4, high: 11, panicLow: 1, panicHigh: 30, source: SOURCE });
  defineRange({ analyte: "PLT", unit: "x10^9/L", low: 150, high: 450, panicLow: 50, panicHigh: 1000, source: SOURCE });
  defineRange({ analyte: "K", unit: "mmol/L", low: 3.5, high: 5.1, panicLow: 2.5, panicHigh: 6.5, source: SOURCE });
  defineRange({ analyte: "NA", unit: "mmol/L", low: 135, high: 145, panicLow: 120, panicHigh: 160, source: SOURCE });
  defineRange({ analyte: "GLUCOSE", unit: "mmol/L", low: 3.9, high: 7.8, panicLow: 2.5, panicHigh: 25, source: SOURCE });
  defineRange({ analyte: "CREATININE", unit: "umol/L", low: 60, high: 110, panicHigh: 500, source: SOURCE });
}

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

  importCodes({
    system: ICD11,
    // Names the release these were checked against, so a coder challenged on a
    // code can be told where it came from.
    source: "ICD-11 MMS (starter set, verified individually)",
    concepts: ICD11_STARTER.map((c) => ({ ...c, verified: true })),
    byUserName: "seed",
  });

  importProducts({
    source: "starter formulary — PPB registrations are placeholders, load the real register",
    products: FORMULARY_STARTER.map((p) => ({
      ...p,
      // Placeholder registrations so the starter set is usable end to end. The
      // real numbers come from the PPB register; `ppb_registration` being
      // present is what lets a product be dispensed at all.
      ppbRegistration: `PPB-PLACEHOLDER-${p.code}`,
    })),
    byUserName: "seed",
  });

  seedRevenueCycle();
  seedReferenceRanges();
  seedProgrammes();
  seedImmunisationSchedule();
  seedReferralDirectory();

  // Every way out of the building, installed in demo mode. Nothing calls a real
  // payer or the tax authority until an operator switches an endpoint to live,
  // and that is refused until a live adapter exists.
  seedEndpoints();
}

/**
 * The demonstration second factor.
 *
 * Deliberately a known value so a demonstration can produce working codes.
 * Never used outside `seedDemo`, and a real enrolment never reuses it.
 */
export const DEMO_MFA_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/**
 * A demonstration facility with staff — used by tests, the seed script and a
 * sales demonstration. Every account ships needing a password change.
 */
export function seedDemo(): {
  facilityId: number;
  adminId: number;
  clinicianId: number;
  receptionistId: number;
  pharmacistId: number;
  labTechId: number;
} {
  seedReferenceData();

  const existing = get<{ id: number }>(`SELECT id FROM facilities WHERE kmhfl_code = 'DEMO-0001'`);
  if (existing) {
    const admin = get<{ id: number }>(`SELECT id FROM users WHERE username = 'admin'`)!;
    const clinician = get<{ id: number }>(`SELECT id FROM users WHERE username = 'a.wanjiru'`)!;
    const reception = get<{ id: number }>(`SELECT id FROM users WHERE username = 'j.otieno'`)!;
    seedStores(existing.id);
    seedWards(existing.id);
    const pharmacist = get<{ id: number }>(`SELECT id FROM users WHERE username = 'g.kimani'`)!;
    const labTech = get<{ id: number }>(`SELECT id FROM users WHERE username = 's.mutiso'`)!;
    return {
      facilityId: existing.id,
      adminId: admin.id,
      clinicianId: clinician.id,
      receptionistId: reception.id,
      pharmacistId: pharmacist.id,
      labTechId: labTech.id,
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

  // Stores and wards need a facility to belong to, so they come after it exists.
  seedStores(facilityId);
  seedTheatres(facilityId);
  seedWards(facilityId);

  // Three roles, because that is what one person does in a Level 2 clinic: they
  // configure the facility, they work the claims, and on a busy morning they
  // are on the front desk. Roles are additive and each is visible in the
  // administration screen, which is the honest way to say so — better than
  // quietly widening what "administrator" means for everybody.
  const adminId = createUser({
    facilityId,
    name: "Facility Administrator",
    username: "admin",
    password: "ChangeMe123",
    cadreCode: "administrative",
    roles: ["administrator", "claims_officer", "receptionist"],
    mustChangePassword: true,
    byUserName: "seed",
  });

  const clinicianId = createUser({
    facilityId,
    name: "Dr. Achieng Wanjiru",
    username: "a.wanjiru",
    password: "ChangeMe123",
    cadreCode: "medical_officer",
    roles: ["clinician", "triage_nurse"],
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

  const pharmacistId = createUser({
    facilityId,
    name: "Grace Kimani",
    username: "g.kimani",
    password: "ChangeMe123",
    cadreCode: "pharmacist",
    roles: ["pharmacist"],
    mustChangePassword: true,
    byUserId: adminId,
    byUserName: "seed",
  });

  // Dispensing is licence-gated, and a controlled drug doubly so. Without a
  // current PPB registration this account can sign in and see the counter but
  // cannot hand anything over — which is the rule, not a limitation of the demo.
  recordLicence({
    userId: pharmacistId,
    regulator: "PPB",
    licenceNumber: "PPB-DEMO-2219",
    expiresOn: nextYear,
    byUserId: adminId,
    byUserName: "seed",
  });

  registerDevice({
    facilityId,
    code: "PHR1",
    label: "Pharmacy counter",
    byUserId: adminId,
    byUserName: "seed",
  });

  const labTechId = createUser({
    facilityId,
    name: "Samuel Mutiso",
    username: "s.mutiso",
    password: "ChangeMe123",
    cadreCode: "lab_technologist",
    roles: ["lab_technologist"],
    mustChangePassword: true,
    byUserId: adminId,
    byUserName: "seed",
  });

  // Releasing a result is licence-gated: a reading becomes a result when
  // somebody the KMLTTB registers puts their name to it.
  recordLicence({
    userId: labTechId,
    regulator: "KMLTTB",
    licenceNumber: "KMLTTB-DEMO-8802",
    expiresOn: nextYear,
    byUserId: adminId,
    byUserName: "seed",
  });

  registerDevice({
    facilityId,
    code: "LAB1",
    label: "Laboratory bench",
    byUserId: adminId,
    byUserName: "seed",
  });

  // A second factor, enrolled, so the actions that need one can be shown:
  // merging two patient records, refunding money, dispensing a controlled drug.
  //
  // THE SECRET IS FIXED AND PUBLIC. That is the point of a demonstration seed —
  // the person showing the system enters it into an authenticator app once and
  // the codes work. A real facility enrols each person through
  // `beginMfaEnrolment`, which generates a secret nobody else has ever seen.
  for (const userId of [adminId, pharmacistId]) {
    enableMfa({ userId, secret: DEMO_MFA_SECRET, byUserName: "seed" });
  }

  audit({
    action: "demo_seeded",
    entity: "facility",
    entityId: facilityId,
    facilityId,
    actorName: "seed",
    purpose: "administration",
    detail: { users: 5 },
  });

  return { facilityId, adminId, clinicianId, receptionistId, pharmacistId, labTechId };
}

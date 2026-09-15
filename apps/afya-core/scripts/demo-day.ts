/**
 * A realistic morning at the demo clinic.
 *
 *   npm run seed && node --experimental-strip-types scripts/demo-day.ts
 *
 * Populates the system with a plausible outpatient session so every screen has
 * something real on it: a queue with genuine triage priorities, consultations at
 * different stages, and claims in enough states for the acceptance rate and the
 * rejection ranking to mean something.
 *
 * DEMONSTRATION DATA. Every person here is invented. It exists so the interface
 * can be shown and reviewed, not to represent any real patient or facility.
 */

import { seedDemo } from "../src/lib/seed.ts";
import { registerDevice, setOdpcRegistration, getFacility } from "../src/lib/facility.ts";
import { registerPatient } from "../src/lib/patients.ts";
import { recordConsent, checkIn, recordVitals, setPriority, advanceVisit } from "../src/lib/frontdesk.ts";
import { openEncounter, addDiagnosis, writeNote, closeEncounter } from "../src/lib/encounters.ts";
import { prescribe, recordAllergy } from "../src/lib/prescribing.ts";
import { verifyCoverage, type PayerProbe } from "../src/lib/payers.ts";
import { assembleCharges, issueInvoice, addCharge, flushEtims } from "../src/lib/billing.ts";
import { assembleClaim, submitClaim, recordOutcome, claimsSummary } from "../src/lib/claims.ts";
import { closeDb, run, verifyAuditChain } from "../src/lib/db.ts";

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();

// The facility is properly set up, so the dashboard shows a working clinic
// rather than a wall of red. The ODPC expiry is deliberately near, to show the
// warning state doing its job.
run(
  `UPDATE facilities SET sha_provider_code = 'SHA-PRV-00417', kra_pin = 'P051234567X' WHERE id = ?`,
  facilityId,
);
setOdpcRegistration({
  facilityId,
  registration: "ODPC/DC/2025/04417",
  expiresOn: new Date(Date.now() + 41 * 86_400_000).toISOString().slice(0, 10),
  byUserId: adminId,
  byUserName: "Facility Administrator",
});

for (const [code, label] of [
  ["REC1", "Reception desk"],
  ["CONS", "Consulting room 1"],
  ["TRI1", "Triage bay"],
] as const) {
  try {
    registerDevice({ facilityId, code, label, byUserId: adminId, byUserName: "Facility Administrator" });
  } catch {
    // Already registered by the base seed.
  }
}

const REC = "REC1";
const CONS = "CONS";
const DOC = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru" };
const DESK = { byUserId: receptionistId, byUserName: "Joseph Otieno" };

/** A payer that answers, so the demo shows verified cover rather than only the offline path. */
const SHA_UP: PayerProbe = () => ({ reachable: true, active: true, schemeName: "Taifa Care" });

interface Person {
  given: string;
  family: string;
  sex: "male" | "female";
  dob: string;
  nid?: string;
  phone: string;
  village: string;
  member?: string;
}

const PEOPLE: Person[] = [
  { given: "Grace", family: "Njeri", sex: "female", dob: "1993-11-02", nid: "30991144", phone: "0721456789", village: "Kawangware", member: "SHA-4471201" },
  { given: "Samuel", family: "Mutiso", sex: "male", dob: "1984-07-21", nid: "22114455", phone: "0711223344", village: "Kibera", member: "SHA-2210984" },
  { given: "Faith", family: "Chebet", sex: "female", dob: "2019-06-14", phone: "0733445566", village: "Mwiki" },
  { given: "Peter", family: "Omondi", sex: "male", dob: "1968-01-30", nid: "9887766", phone: "0700112233", village: "Umoja", member: "SHA-1198773" },
  { given: "Mercy", family: "Wairimu", sex: "female", dob: "1997-03-08", nid: "34556677", phone: "0716887766", village: "Kayole", member: "SHA-3455667" },
  { given: "Daniel", family: "Kiprop", sex: "male", dob: "1990-09-19", nid: "31445566", phone: "0799887766", village: "Githurai" },
];

const mrns: string[] = [];

for (const p of PEOPLE) {
  const mrn = registerPatient({
    facilityId,
    deviceCode: REC,
    givenName: p.given,
    familyName: p.family,
    sex: p.sex,
    dateOfBirth: p.dob,
    nationalId: p.nid ?? null,
    shaNumber: p.member ?? null,
    phone: p.phone,
    county: "Nairobi",
    village: p.village,
    ...DESK,
  });
  mrns.push(mrn);

  for (const purpose of ["treatment", "billing", "claim"] as const) {
    recordConsent({ patientMrn: mrn, purpose, granted: true, ...DESK });
  }

  if (p.member) {
    verifyCoverage({
      patientMrn: mrn,
      payerCode: "SHA",
      memberNumber: p.member,
      probe: SHA_UP,
      ...DESK,
    });
  }
}

const [GRACE, SAMUEL, FAITH, PETER, MERCY, DANIEL] = mrns;

// A child with a recorded allergy, so the consultation screen shows the banner
// and the prescribing guard has something real to act on.
recordAllergy({
  patientMrn: FAITH,
  substance: "amoxicillin",
  reaction: "widespread rash",
  severity: "severe",
  byUserId: clinicianId,
  byUserName: DOC.byUserName,
});

// ------------------------------------------------------------------ the queue

const waiting = [
  { mrn: PETER, priority: "emergency" as const, vitals: { tempTenthsC: 372, systolicMmhg: 178, diastolicMmhg: 104, pulseBpm: 104, spo2Percent: 94 } },
  { mrn: FAITH, priority: "urgent" as const, vitals: { tempTenthsC: 391, pulseBpm: 128, respRate: 34, spo2Percent: 96, weightGrams: 13_200 } },
  { mrn: MERCY, priority: "routine" as const, vitals: { tempTenthsC: 368, systolicMmhg: 118, diastolicMmhg: 76, pulseBpm: 78 } },
  { mrn: DANIEL, priority: "routine" as const, vitals: undefined },
];

for (const w of waiting) {
  const visit = checkIn({ facilityId, patientMrn: w.mrn, priority: w.priority, deviceCode: REC, ...DESK });
  if (w.vitals) {
    recordVitals({ visitId: visit.id, ...w.vitals, byUserId: adminId, byUserName: "Triage Nurse" });
  }
}

// ------------------------------------------------------ completed consultations

interface Case {
  mrn: string;
  code: string;
  complaint: string;
  assessment: string;
  plan: string;
  rx?: { product: string; dose: string; frequency: string; quantity: number };
  extra?: string;
  payer: "SHA" | "CASH";
  outcome?: "accepted" | "paid" | "rejected";
  rejection?: { code: string; reason: string };
}

const CASES: Case[] = [
  {
    mrn: GRACE, code: "1F40", payer: "SHA", outcome: "paid",
    complaint: "Fever and headache for three days",
    assessment: "Falciparum malaria, RDT positive",
    plan: "AL six doses over three days, paracetamol as needed, review if no better in 48 hours",
    rx: { product: "AL-20-120", dose: "4 tablets", frequency: "twice daily", quantity: 24 },
    extra: "LAB-MRDT",
  },
  {
    mrn: SAMUEL, code: "CA07", payer: "SHA", outcome: "accepted",
    complaint: "Sore throat and blocked nose, four days",
    assessment: "Acute upper respiratory infection, viral",
    plan: "Symptomatic care, no antibiotic indicated. Return if fever persists beyond five days",
    rx: { product: "PARA-500", dose: "1 g", frequency: "three times daily", quantity: 21 },
  },
  {
    mrn: GRACE, code: "GC08", payer: "SHA", outcome: "rejected",
    complaint: "Burning on passing urine",
    assessment: "Lower urinary tract infection",
    plan: "Nitrofurantoin course, increase fluids, review in one week",
    rx: { product: "CTX-960", dose: "960 mg", frequency: "twice daily", quantity: 10 },
    extra: "LAB-URIN",
    rejection: { code: "E07", reason: "Laboratory report not attached" },
  },
];

let n = 0;
for (const c of CASES) {
  // A patient can only have one encounter open at a time, so each is closed
  // before the next begins — exactly as a real clinic works.
  const enc = openEncounter({
    facilityId,
    patientMrn: c.mrn,
    kind: "outpatient",
    clinicianId,
    clinicianName: DOC.byUserName,
    deviceCode: CONS,
  });

  addDiagnosis({ encounterId: enc, code: c.code, ...DOC, deviceCode: CONS });
  writeNote({
    encounterId: enc,
    complaint: c.complaint,
    examination: "Alert, well perfused. Chest clear, abdomen soft.",
    assessment: c.assessment,
    plan: c.plan,
    authorId: clinicianId,
    authorName: DOC.byUserName,
    deviceCode: CONS,
  });

  if (c.rx) {
    prescribe({
      encounterId: enc,
      productCode: c.rx.product,
      dose: c.rx.dose,
      frequency: c.rx.frequency,
      quantity: c.rx.quantity,
      deviceCode: CONS,
      prescriberId: clinicianId,
      prescriberName: DOC.byUserName,
    });
  }

  assembleCharges({ encounterId: enc, payerCode: c.payer, deviceCode: CONS, ...DOC });
  if (c.extra) {
    addCharge({
      encounterId: enc,
      serviceCode: c.extra,
      payerCode: c.payer,
      sourceKind: "lab",
      deviceCode: CONS,
      ...DOC,
    });
  }
  issueInvoice({ encounterId: enc, payerCode: c.payer, deviceCode: CONS, ...DOC });
  closeEncounter({ encounterId: enc, byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: CONS });

  if (c.payer !== "CASH") {
    const claim = assembleClaim({ encounterId: enc, payerCode: c.payer, deviceCode: CONS, ...DOC });
    const result = submitClaim({
      claimId: claim,
      byUserId: adminId,
      byUserName: "Claims Officer",
      submit: () => ({ ok: true, reference: `SHA-${String(++n).padStart(6, "0")}` }),
    });
    if (result.submitted && c.outcome) {
      recordOutcome({
        claimId: claim,
        outcome: c.outcome,
        rejectionCode: c.rejection?.code,
        rejectionReason: c.rejection?.reason,
        byUserId: adminId,
        byUserName: "Claims Officer",
      });
    }
  }
}

// An open consultation waiting to be finished, so the scrubber has a live claim
// to show mid-visit rather than only decided history.
const liveEnc = openEncounter({
  facilityId,
  patientMrn: MERCY,
  kind: "outpatient",
  clinicianId,
  clinicianName: DOC.byUserName,
  deviceCode: CONS,
});
addDiagnosis({ encounterId: liveEnc, code: "CA23", ...DOC, deviceCode: CONS });
writeNote({
  encounterId: liveEnc,
  complaint: "Wheeze and night cough, worse this week",
  examination: "Bilateral expiratory wheeze, no distress at rest.",
  assessment: "Asthma, moderate exacerbation",
  plan: "Salbutamol inhaler, review in two weeks with peak flow",
  authorId: clinicianId,
  authorName: DOC.byUserName,
  deviceCode: CONS,
});
prescribe({
  encounterId: liveEnc,
  productCode: "SALB-INH",
  dose: "2 puffs",
  frequency: "as needed, up to four times daily",
  quantity: 1,
  deviceCode: CONS,
  prescriberId: clinicianId,
  prescriberName: DOC.byUserName,
});
assembleCharges({ encounterId: liveEnc, payerCode: "SHA", deviceCode: CONS, ...DOC });
issueInvoice({ encounterId: liveEnc, payerCode: "SHA", deviceCode: CONS, ...DOC });
assembleClaim({ encounterId: liveEnc, payerCode: "SHA", deviceCode: CONS, ...DOC });

// Most invoices have reached KRA; one stays queued so the backlog indicator is
// showing its real state rather than a permanent zero.
let k = 0;
flushEtims((payload) =>
  ++k <= 3
    ? { ok: true, canonicalNumber: `KRA-INV-${String(k).padStart(6, "0")}` }
    : { ok: false, error: "KRA gateway timeout" },
);

// ------------------------------------------------------------------- summary

const summary = claimsSummary();
const chain = verifyAuditChain();
const facility = getFacility(facilityId)!;

console.log(`Demo day loaded for ${facility.name} (KMHFL ${facility.kmhfl_code}).`);
console.log(`  patients          ${PEOPLE.length}`);
console.log(`  in the queue      ${waiting.length}`);
console.log(`  claims            ${summary.total} · acceptance ${summary.acceptanceRatePercent}%`);
console.log(`  value at risk     ${summary.valueAtRiskCents / 100} KES`);
console.log(`  audit chain       ${chain.ok ? `intact, ${chain.checked} entries` : "BROKEN"}`);
console.log(``);
console.log(`Sign in:  admin / a.wanjiru / j.otieno   password ChangeMe123`);

closeDb();

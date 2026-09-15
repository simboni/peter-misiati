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

import { seedDemo, DEMO_MFA_SECRET } from "../src/lib/seed.ts";
import { registerDevice, setOdpcRegistration, getFacility } from "../src/lib/facility.ts";
import { registerPatient } from "../src/lib/patients.ts";
import { recordConsent, checkIn, recordVitals, setPriority, advanceVisit } from "../src/lib/frontdesk.ts";
import { openEncounter, addDiagnosis, writeNote, closeEncounter } from "../src/lib/encounters.ts";
import { prescribe, recordAllergy } from "../src/lib/prescribing.ts";
import { verifyCoverage, type PayerProbe } from "../src/lib/payers.ts";
import {
  assembleCharges, issueInvoice, addCharge, flushEtims,
  recordPayment, refundPayment, outstandingInvoices, takings,
} from "../src/lib/billing.ts";
import { assembleClaim, submitClaim, recordOutcome, claimsSummary } from "../src/lib/claims.ts";
import { receiveStock, quarantineBatch, recordCount, pickable, onHand, stockValue } from "../src/lib/inventory.ts";
import { dispense } from "../src/lib/pharmacy.ts";
import { placeOrder, acknowledgeResult } from "../src/lib/orders.ts";
import { collectSpecimen, enterResult, releaseResults } from "../src/lib/laboratory.ts";
import { admit, recordObservation, scheduleDoses, recordAdministration, billBedNights, discharge } from "../src/lib/inpatient.ts";
import { openClinic, book, availability, sendReminders, closeOutDay, markArrived } from "../src/lib/scheduling.ts";
import { generateReturn, submitToDhis2, detectNotifiable } from "../src/lib/reporting.ts";
import { sweep, countOpen } from "../src/lib/notifications.ts";
import { closeDb, run, get, all as dbAll, verifyAuditChain, today } from "../src/lib/db.ts";

const { facilityId, adminId, clinicianId, receptionistId, pharmacistId, labTechId } = seedDemo();

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
  ["PHR1", "Pharmacy counter"],
  ["LAB1", "Laboratory bench"],
  ["WRD1", "Ward station"],
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
  // Two self-paying patients. Not every patient has cover, and a till with
  // nothing on it demonstrates nothing.
  {
    mrn: DANIEL, code: "1A40", payer: "CASH",
    complaint: "Vomiting and loose stool since last night",
    assessment: "Acute gastroenteritis, mild dehydration",
    plan: "ORS and zinc, review if unable to keep fluids down",
    rx: { product: "ORS-1L", dose: "1 sachet", frequency: "after each stool", quantity: 6 },
  },
  {
    mrn: FAITH, code: "CA07", payer: "CASH",
    complaint: "Cough and runny nose for two days",
    assessment: "Upper respiratory infection, viral",
    plan: "Symptomatic care. No antibiotic indicated",
    rx: { product: "PARA-500", dose: "250 mg", frequency: "three times daily", quantity: 12 },
    extra: "PROC-NEB",
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
      sourceKind: c.extra.startsWith("PROC-") ? "procedure" : "lab",
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

// ------------------------------------------------------------------- stock
//
// The store is loaded the way a real one is: several batches per product with
// different expiry dates, so first-expiry-first-out has something to prove.

const PHARM = "PHARM";
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const DELIVERIES: [string, string, number, number, number][] = [
  // product, batch, days to expiry, quantity, unit cost in cents
  ["AL-20-120", "AL-2411", 420, 180, 22_000],
  ["AL-20-120", "AL-2402", 55, 40, 22_000],
  ["PARA-500", "PA-8801", 500, 2_400, 180],
  ["PARA-500", "PA-8790", 70, 300, 180],
  ["AMOX-500", "AM-5512", 380, 600, 900],
  ["AMOX-125S", "AS-2201", 240, 80, 18_000],
  ["CTX-960", "CT-3390", 310, 400, 600],
  ["ORS-1L", "OR-1180", 600, 500, 3_500],
  ["ZINC-20", "ZN-4420", 450, 800, 200],
  ["SALB-INH", "SB-7710", 330, 45, 62_000],
  ["METRO-400", "MT-2290", 290, 350, 500],
  ["IBU-400", "IB-6610", 400, 500, 420],
  ["MORPH-10", "MO-0091", 270, 60, 32_000],
  // Deliberately shallow, so the reorder report has something to say.
  ["CTX-960", "CT-3399", 40, 12, 600],
];

for (const [product, batch, days, quantity, cost] of DELIVERIES) {
  receiveStock({
    storeCode: PHARM,
    productCode: product,
    batchNumber: batch,
    expiresOn: inDays(days),
    quantity,
    unitCostCents: cost,
    deviceCode: "PHR1",
    byUserId: adminId,
    byUserName: "Facility Administrator",
  });
}

// A recall, so the quarantine state is visible and the trace has a batch to
// follow. Nothing was dispensed from it, which is the good outcome.
const recalled = pickable(PHARM, "IBU-400")[0];
quarantineBatch({
  batchId: recalled.id,
  reason: "PPB recall notice 2026/04 — suspect packaging integrity",
  byUserId: adminId,
  byUserName: "Facility Administrator",
});

// A stock take that came up short. A discrepancy with a history, not a mystery.
const counted = pickable(PHARM, "PARA-500")[0];
recordCount({
  batchId: counted.id,
  counted: counted.quantity - 34,
  reason: "Monthly count — breakage in transit, reported to the supplier",
  byUserId: adminId,
  byUserName: "Facility Administrator",
});

// ------------------------------------------------------------- dispensing

const PHARMACIST = { dispenserId: pharmacistId, dispenserName: "Grace Kimani" };

const outstanding = dbAll<{ id: string; product_code: string }>(
  `SELECT id, product_code FROM prescriptions WHERE status = 'active' ORDER BY created_at`,
);

// Most of the morning's prescriptions are handed over; the last one is left on
// the counter so the pharmacy screen opens with work on it rather than empty.
for (const rx of outstanding.slice(0, -1)) {
  if (onHand(PHARM, rx.product_code) === 0) continue;
  dispense({
    prescriptionId: rx.id,
    storeCode: PHARM,
    payerCode: "CASH",
    counselling: "Complete the course. Come back if it gets worse.",
    deviceCode: "PHR1",
    ...PHARMACIST,
  });
}

// ------------------------------------------------------------- the laboratory

const LAB = { enteredBy: labTechId, enteredByName: "Samuel Mutiso" };
const RELEASER = { releaserId: labTechId, releaserName: "Samuel Mutiso" };

// Mercy's open consultation gets a full blood count, worked through to a
// released result with a genuinely abnormal value.
const cbc = placeOrder({
  encounterId: liveEnc,
  kind: "lab",
  serviceCode: "LAB-CBC",
  priority: "routine",
  clinicalQuestion: "Recurrent wheeze — rule out infection, check eosinophils",
  payerCode: "SHA",
  deviceCode: "CONS",
  ordererId: clinicianId,
  ordererName: DOC.byUserName,
});
collectSpecimen({ orderId: cbc, kind: "EDTA whole blood", collectorId: labTechId, collectorName: "Samuel Mutiso", deviceCode: "LAB1" });
enterResult({ orderId: cbc, analyte: "HB", value: 11.4, ...LAB, deviceCode: "LAB1" });
enterResult({ orderId: cbc, analyte: "WBC", value: 13.8, ...LAB, deviceCode: "LAB1" });
enterResult({ orderId: cbc, analyte: "PLT", value: 264, ...LAB, deviceCode: "LAB1" });
releaseResults({ orderId: cbc, deviceCode: "LAB1", ...RELEASER });

// A stat order still on the bench, so the worklist shows urgency doing its job.
const stat = placeOrder({
  encounterId: liveEnc,
  kind: "lab",
  serviceCode: "LAB-URIN",
  priority: "stat",
  clinicalQuestion: "Ketones — vomiting since this morning",
  payerCode: "SHA",
  deviceCode: "CONS",
  ordererId: clinicianId,
  ordererName: DOC.byUserName,
});
collectSpecimen({ orderId: stat, kind: "Midstream urine", collectorId: labTechId, collectorName: "Samuel Mutiso", deviceCode: "LAB1" });

// ------------------------------------------------------------------- the ward

const admissionEnc = openEncounter({
  facilityId,
  patientMrn: PETER,
  kind: "inpatient",
  clinicianId,
  clinicianName: DOC.byUserName,
  deviceCode: "WRD1",
});
addDiagnosis({ encounterId: admissionEnc, code: "CA40", ...DOC, deviceCode: "WRD1" });
writeNote({
  encounterId: admissionEnc,
  complaint: "Breathless, productive cough, fever for two days",
  examination: "Crackles right base. Saturations 92% on air.",
  assessment: "Community-acquired pneumonia, CRB-65 2",
  plan: "Admit. IV antibiotics, oxygen as needed, review in the morning.",
  authorId: clinicianId,
  authorName: DOC.byUserName,
  deviceCode: "WRD1",
});

const admission = admit({
  encounterId: admissionEnc,
  wardCode: "GEN",
  bedCode: "GEN-1",
  reason: "Community-acquired pneumonia, for IV antibiotics and oxygen",
  byUserId: clinicianId,
  byUserName: DOC.byUserName,
  deviceCode: "WRD1",
});

// Backdated two nights so the bed-night billing and the length of stay are real.
run(`UPDATE admissions SET admitted_at = ? WHERE id = ?`, `${inDays(-2)}T14:20:00.000Z`, admission);

// A patient who arrived unwell and is improving — the trend a ward round reads.
// Stamped hours apart, because three observations at the same minute read as a
// data-entry exercise rather than a patient getting better.
const rounds = [
  { hoursAgo: 44, obs: { respRate: 26, spo2: 92, systolic: 104, diastolic: 62, pulse: 112, temp: 38.9 }, note: "On admission. Started IV ceftriaxone." },
  { hoursAgo: 20, obs: { respRate: 22, spo2: 94, systolic: 112, diastolic: 70, pulse: 96, temp: 38.1 }, note: "Overnight. Settled, sleeping." },
  { hoursAgo: 2, obs: { respRate: 18, spo2: 96, systolic: 118, diastolic: 76, pulse: 84, temp: 37.2 }, note: "Morning round. Much improved, eating." },
];

for (const round of rounds) {
  const recorded = recordObservation({
    admissionId: admission,
    observation: round.obs,
    note: round.note,
    byUserId: clinicianId,
    byUserName: DOC.byUserName,
  });
  run(
    `UPDATE ward_observations SET recorded_at = ? WHERE id = ?`,
    new Date(Date.now() - round.hoursAgo * 3_600_000).toISOString(),
    recorded.id,
  );
}

const wardRx = prescribe({
  encounterId: admissionEnc,
  productCode: "AMOX-500",
  dose: "500 mg",
  frequency: "three times daily",
  quantity: 21,
  durationDays: 7,
  deviceCode: "WRD1",
  prescriberId: clinicianId,
  prescriberName: DOC.byUserName,
});
// Charted from today — the antibiotic was started on this morning's round, and
// back-dating it would put rows on the chart for days nobody could have given
// it, which reads at a glance as a week of missed doses.
scheduleDoses({
  admissionId: admission,
  prescriptionId: wardRx,
  times: ["08:00", "14:00", "20:00"],
  days: 3,
  from: today(),
  deviceCode: "WRD1",
});

// The morning's doses signed for — one given, one refused, the rest still due.
const doses = dbAll<{ id: string }>(
  `SELECT id FROM medication_administrations WHERE prescription_id = ? ORDER BY due_at`,
  wardRx,
);
recordAdministration({ administrationId: doses[0].id, given: true, byUserId: adminId, byUserName: "Ward Nurse" });
recordAdministration({
  administrationId: doses[1].id,
  given: false,
  omittedReason: "Patient vomiting — dose withheld, doctor informed",
  byUserId: adminId,
  byUserName: "Ward Nurse",
});

billBedNights({
  facilityId,
  payerCode: "CASH",
  deviceCode: "WRD1",
  byUserId: adminId,
  byUserName: "Facility Administrator",
});

// A second, shorter admission already discharged, so the census has history.
const shortStayEnc = openEncounter({
  facilityId,
  patientMrn: DANIEL,
  kind: "inpatient",
  clinicianId,
  clinicianName: DOC.byUserName,
  deviceCode: "WRD1",
});
addDiagnosis({ encounterId: shortStayEnc, code: "1A40", ...DOC, deviceCode: "WRD1" });
writeNote({
  encounterId: shortStayEnc,
  complaint: "Vomiting and watery stool since yesterday",
  examination: "Mildly dehydrated, abdomen soft.",
  assessment: "Acute gastroenteritis with mild dehydration",
  plan: "IV fluids overnight, ORS, discharge when tolerating orally",
  authorId: clinicianId,
  authorName: DOC.byUserName,
  deviceCode: "WRD1",
});
const shortStay = admit({
  encounterId: shortStayEnc,
  wardCode: "GEN",
  bedCode: "GEN-4",
  reason: "Gastroenteritis, overnight rehydration",
  byUserId: clinicianId,
  byUserName: DOC.byUserName,
  deviceCode: "WRD1",
});
run(`UPDATE admissions SET admitted_at = ? WHERE id = ?`, `${inDays(-1)}T19:40:00.000Z`, shortStay);
discharge({
  admissionId: shortStay,
  type: "home",
  summary:
    "Rehydrated overnight, tolerating oral fluids by morning. ORS and zinc to continue at home. " +
    "Return if unable to keep fluids down or if the stool becomes bloody.",
  byUserId: clinicianId,
  byUserName: DOC.byUserName,
  deviceCode: "WRD1",
});

// ------------------------------------------------------------- appointments

const TOMORROW = inDays(1);
openClinic({
  facilityId,
  providerId: clinicianId,
  date: TOMORROW,
  from: "09:00",
  to: "12:00",
  minutes: 20,
  deviceCode: REC,
});

const slots = availability({ facilityId, date: TOMORROW });
for (const [index, mrn] of [GRACE, MERCY, SAMUEL].entries()) {
  book({
    slotId: slots[index].id,
    patientMrn: mrn,
    reason: ["Malaria follow-up", "Asthma review with peak flow", "Blood pressure check"][index],
    deviceCode: REC,
    ...DESK,
  });
}
sendReminders({ facilityId, date: TOMORROW });

// Today's clinic too, so the screen opens on a day with something on it. One
// patient has already arrived and is in the queue; the rest are still expected.
const TODAY = today();
openClinic({ facilityId, providerId: clinicianId, date: TODAY, from: "09:00", to: "12:00", minutes: 20, deviceCode: REC });
const todaySlots = availability({ facilityId, date: TODAY });
for (const [index, mrn] of [FAITH, DANIEL, PETER].entries()) {
  const appointment = book({
    slotId: todaySlots[index].id,
    patientMrn: mrn,
    reason: ["Cough review", "Results discussion", "Blood pressure check"][index],
    deviceCode: REC,
    ...DESK,
  });
  if (index === 0) {
    const visit = get<{ id: string }>(`SELECT id FROM visits WHERE patient_mrn = ? LIMIT 1`, mrn);
    if (visit) markArrived({ appointmentId: appointment, visitId: visit.id });
  }
}

// Yesterday's clinic, closed out, so the no-show rate is a real number rather
// than a permanent dash.
//
// Booked through the ordinary path and then moved back a day, because `book`
// refuses a slot in the past — which is the rule working, not an obstacle to
// route around with a direct insert.
const YESTERDAY = inDays(-1);
openClinic({ facilityId, providerId: clinicianId, date: TOMORROW, from: "14:00", to: "16:00", minutes: 20, deviceCode: REC });
const afternoon = dbAll<{ id: string }>(
  `SELECT id FROM slots WHERE slot_date = ? AND start_time >= '14:00' ORDER BY start_time`,
  TOMORROW,
);

const yesterdaysAppointments: string[] = [];
for (const [index, mrn] of [PETER, DANIEL, FAITH, GRACE].entries()) {
  yesterdaysAppointments.push(
    book({ slotId: afternoon[index].id, patientMrn: mrn, reason: "Review", deviceCode: REC, ...DESK }),
  );
}
for (const slot of afternoon.slice(0, 4)) {
  run(`UPDATE slots SET slot_date = ? WHERE id = ?`, YESTERDAY, slot.id);
}

// Three of the four came. The fourth is the no-show the rate is made of.
for (const [index, mrn] of [PETER, DANIEL, FAITH].entries()) {
  const visit = get<{ id: string }>(`SELECT id FROM visits WHERE patient_mrn = ? LIMIT 1`, mrn);
  if (visit) markArrived({ appointmentId: yesterdaysAppointments[index], visitId: visit.id });
}
closeOutDay({ facilityId, date: YESTERDAY });

// --------------------------------------------------------------- reporting

detectNotifiable(facilityId);

const period = today().slice(0, 7);
for (const form of ["MOH705A", "MOH705B", "MOH717"] as const) {
  generateReturn({
    facilityId,
    form,
    period,
    byUserId: adminId,
    byUserName: "Facility Administrator",
    deviceCode: REC,
  });
}
// One submitted, so the variance panel has something to compare against; the
// others stay draft so the "generate then submit" flow can be demonstrated.
submitToDhis2({ facilityId, form: "MOH717", period, byUserId: adminId, byUserName: "Facility Administrator" });

// Everything with a clock on it, raised onto the right desks.
sweep(facilityId);

// --------------------------------------------------------------------- the till
//
// Cash invoices in the states a cashier actually sees on a Monday: one settled
// in full, one part-paid, one paid then partly refunded, and one left old
// enough to land in the ageing report.

const cashOwed = outstandingInvoices(facilityId).filter((o) => !o.payerOwes);

if (cashOwed[0]) {
  recordPayment({
    invoiceId: cashOwed[0].invoice.id,
    method: "mpesa",
    amountCents: cashOwed[0].balanceCents,
    reference: "QK71HJ2P9A",
    deviceCode: REC,
    ...DESK,
  });
}

if (cashOwed[1]) {
  // Part-paid: the patient had some of it and will bring the rest.
  recordPayment({
    invoiceId: cashOwed[1].invoice.id,
    method: "cash",
    amountCents: Math.round(cashOwed[1].balanceCents / 2),
    deviceCode: REC,
    ...DESK,
  });
}

if (cashOwed[2]) {
  const paid = recordPayment({
    invoiceId: cashOwed[2].invoice.id,
    method: "cash",
    amountCents: cashOwed[2].balanceCents,
    deviceCode: REC,
    ...DESK,
  });
  // And a refund, so the negative row and the reason are visible on screen.
  refundPayment({
    paymentId: paid,
    amountCents: 20_000,
    reason: "Nebulisation charged but not given — child settled before it was set up",
    deviceCode: REC,
    byUserId: adminId,
    byUserName: "Facility Administrator",
  });
}

// One invoice aged so the debtor ageing is not four empty buckets.
const stillOwed = outstandingInvoices(facilityId).filter((o) => !o.payerOwes);
if (stillOwed.at(-1)) {
  run(
    `UPDATE invoices SET issued_at = ? WHERE id = ?`,
    `${inDays(-97)}T11:20:00.000Z`,
    stillOwed.at(-1)!.invoice.id,
  );
}

// ------------------------------------------------------------------- summary

const summary = claimsSummary();
const chain = verifyAuditChain();
const facility = getFacility(facilityId)!;

const count = (sql: string, ...params: (string | number)[]) =>
  get<{ n: number }>(sql, ...params)?.n ?? 0;

const stock = stockValue(PHARM);
const alerts = countOpen(facilityId);

console.log(`Demo day loaded for ${facility.name} (KMHFL ${facility.kmhfl_code}).`);
console.log(``);
console.log(`  patients          ${PEOPLE.length}`);
console.log(`  in the queue      ${waiting.length}`);
console.log(`  dispensed         ${count(`SELECT COUNT(*) AS n FROM dispenses`)} · stock on the shelf ${Math.round(stock.valueCents / 100)} KES`);
console.log(`  lab orders        ${count(`SELECT COUNT(*) AS n FROM orders`)} · ${count(`SELECT COUNT(*) AS n FROM lab_results WHERE released_at IS NOT NULL`)} results released`);
console.log(`  admissions        ${count(`SELECT COUNT(*) AS n FROM admissions`)} · ${count(`SELECT COUNT(*) AS n FROM admissions WHERE discharged_at IS NULL`)} still in a bed`);
console.log(`  appointments      ${count(`SELECT COUNT(*) AS n FROM appointments`)} booked`);
console.log(`  MOH returns       ${count(`SELECT COUNT(*) AS n FROM moh_returns`)} generated, ${count(`SELECT COUNT(*) AS n FROM moh_returns WHERE status = 'submitted'`)} submitted`);
console.log(`  taken today       ${Math.round(takings(facilityId).reduce((sum, t) => sum + t.netCents, 0) / 100)} KES`);
console.log(`  owed              ${Math.round(outstandingInvoices(facilityId).reduce((sum, o) => sum + o.balanceCents, 0) / 100)} KES across ${outstandingInvoices(facilityId).length} invoices`);
console.log(`  claims            ${summary.total} · acceptance ${summary.acceptanceRatePercent}%`);
console.log(`  value at risk     ${summary.valueAtRiskCents / 100} KES`);
console.log(`  alerts            ${alerts.total} open, ${alerts.critical} critical`);
console.log(`  audit chain       ${chain.ok ? `intact, ${chain.checked} entries` : "BROKEN"}`);
console.log(``);
console.log(`Sign in at http://localhost:3200 — password ChangeMe123 for all of them:`);
console.log(`  admin       Facility Administrator  — compliance, integrations, staff, tariffs`);
console.log(`  a.wanjiru   Dr. Achieng Wanjiru     — consultations, orders, prescribing, the ward`);
console.log(`  j.otieno    Joseph Otieno           — reception, the queue, appointments, payment`);
console.log(`  g.kimani    Grace Kimani            — the pharmacy counter and the controlled register`);
console.log(`  s.mutiso    Samuel Mutiso           — the laboratory bench`);
console.log(``);
console.log(`Two-factor codes for admin and g.kimani come from the secret ${DEMO_MFA_SECRET}`);
console.log(`(enter it in any authenticator app — it is a demonstration value, published on purpose).`);

closeDb();

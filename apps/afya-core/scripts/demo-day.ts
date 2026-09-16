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
import { recordLicence, createUser } from "../src/lib/users.ts";
import { registerPatient } from "../src/lib/patients.ts";
import { recordConsent, checkIn, recordVitals, setPriority, advanceVisit } from "../src/lib/frontdesk.ts";
import { openEncounter, addDiagnosis, writeNote, closeEncounter } from "../src/lib/encounters.ts";
import { prescribe, recordAllergy } from "../src/lib/prescribing.ts";
import { verifyCoverage, type PayerProbe } from "../src/lib/payers.ts";
import {
  assembleCharges, issueInvoice, addCharge, flushEtims,
  recordPayment, refundPayment, outstandingInvoices, takings,
} from "../src/lib/billing.ts";
import { assembleClaim, submitClaim, claimsSummary } from "../src/lib/claims.ts";
import { receiveStock, quarantineBatch, recordCount, pickable, onHand, stockValue } from "../src/lib/inventory.ts";
import { dispense } from "../src/lib/pharmacy.ts";
import { placeOrder, acknowledgeResult } from "../src/lib/orders.ts";
import { collectSpecimen, enterResult, releaseResults } from "../src/lib/laboratory.ts";
import { admit, recordObservation, scheduleDoses, recordAdministration, billBedNights, discharge } from "../src/lib/inpatient.ts";
import { openClinic, book, availability, sendReminders, closeOutDay, markArrived } from "../src/lib/scheduling.ts";
import { generateReturn, submitToDhis2, detectNotifiable } from "../src/lib/reporting.ts";
import { sweep, countOpen } from "../src/lib/notifications.ts";
import { enrol, recordVisit, recordOutcome, sweepDefaulters, cohortReport } from "../src/lib/programmes.ts";
import {
  bookPregnancy, recordAncContact, recordDelivery, recordPncContact, recordImmunisation,
  maternitySummary, PNC_SCHEDULE,
} from "../src/lib/maternity.ts";
import { importRemittance, reconcile, reconciliation } from "../src/lib/remittance.ts";
import {
  raiseRequisition, decideRequisition, recordQuotation, selectQuotation,
  issuePurchaseOrder, receiveDelivery, recordInvoice, runMatch, approveInvoice,
  payInvoice, blockSupplier, procurementSummary,
} from "../src/lib/procurement.ts";
import {
  openAttendance, openUnidentified, identify, triagePatient, startTreatment,
  recordDisposition, openMedicolegalCase, issueP3, declareIncident, emergencySummary,
} from "../src/lib/emergency.ts";
import {
  raiseReferral, acceptReferral, declineReferral, departReferral, confirmArrival,
  recordOutcome as recordReferralOutcome, referralSummary,
} from "../src/lib/referrals.ts";
import {
  openStudy, justifyStudy, answerSafetyCheck, performStudy, reportStudy,
  recordCommunication, radiologySummary, MRI_SCREENING,
} from "../src/lib/radiology.ts";
import {
  bookCase, recordSurgicalConsent, addTeamMember, answerChecklist, completeStage,
  recordCountIn, recordCountOut, resolveCount, arriveInTheatre, startAnaesthesia,
  recordIncision, closeCase, leaveTheatre, completeCase, cancelCase,
  theatreSummary, CHECKLIST, type Stage,
} from "../src/lib/theatre.ts";
import {
  postJournal, postFromOperations, reverseJournal, ledgerSummary, reconcile as reconcileLedger,
  trialBalance, incomeStatement,
} from "../src/lib/accounting.ts";
import {
  addEmployee, addPayItem, createRun as createPayrollRun, approveRun, payRun,
  payrollSummary, statutoryReturn,
} from "../src/lib/payroll.ts";
import {
  issueContract, requestLeave, decideLeave, openCase, recordHearing,
  closeCase as closeHrCase, hrSummary,
} from "../src/lib/hr.ts";
import {
  assetByTag, scheduleMaintenance, recordMaintenance, reportFault, closeWorkOrder,
  recordTemperature, postDepreciation, assetSummary, schedulesFor,
} from "../src/lib/assets.ts";
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

  if (c.extra?.startsWith("LAB-")) {
    // Ordered, collected, read and released — the real loop. The charge is
    // raised by the order, and releasing the result attaches the report, which
    // is what clears the claim's documentation gate. Faking the charge instead
    // would leave a claim the scrubber correctly refuses.
    const order = placeOrder({
      encounterId: enc,
      kind: "lab",
      serviceCode: c.extra,
      clinicalQuestion: c.assessment,
      payerCode: c.payer,
      deviceCode: CONS,
      ordererId: clinicianId,
      ordererName: DOC.byUserName,
    });
    collectSpecimen({
      orderId: order,
      kind: c.extra === "LAB-URIN" ? "Midstream urine" : "Capillary blood",
      collectorId: labTechId,
      collectorName: "Samuel Mutiso",
      deviceCode: "LAB1",
    });
    enterResult({
      orderId: order,
      analyte: c.extra === "LAB-URIN" ? "LEUCOCYTES" : "MRDT",
      valueText: "Positive",
      enteredBy: labTechId,
      enteredByName: "Samuel Mutiso",
      deviceCode: "LAB1",
    });
    releaseResults({ orderId: order, releaserId: labTechId, releaserName: "Samuel Mutiso", deviceCode: "LAB1" });
    acknowledgeResult({ orderId: order, byUserId: clinicianId, byUserName: DOC.byUserName, action: "Seen, treating" });
  } else if (c.extra) {
    addCharge({
      encounterId: enc,
      serviceCode: c.extra,
      payerCode: c.payer,
      sourceKind: "procedure",
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
    // Deliberately NOT decided here. A claim's outcome arrives on a payment
    // advice from the payer, and the remittance section below is what posts it
    // — which is the loop this system exists to close.
    void result;
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

// ------------------------------------------------------- programme registers
//
// An HIV cohort with the shape a real one has: most retained, one transferred,
// one lost, one still coming but overdue. The defaulter list is the number
// these programmes are judged on, so it must not be empty on the screen.

const PROGRAMME_PEOPLE = [
  { given: "Esther", family: "Nyambura", sex: "female" as const, dob: "1988-05-12", ccc: "CCC-04412" },
  { given: "Joseph", family: "Kamau", sex: "male" as const, dob: "1979-11-30", ccc: "CCC-04418" },
  { given: "Rose", family: "Atieno", sex: "female" as const, dob: "1994-02-08", ccc: "CCC-04431" },
  { given: "Michael", family: "Otieno", sex: "male" as const, dob: "1985-08-21", ccc: "CCC-04440" },
  { given: "Hannah", family: "Cherono", sex: "female" as const, dob: "1991-07-03", ccc: "CCC-04455" },
];

const enrolments: string[] = [];
let ccNid = 41_000_000;

for (const [index, person] of PROGRAMME_PEOPLE.entries()) {
  const mrn = registerPatient({
    facilityId,
    deviceCode: REC,
    givenName: person.given,
    familyName: person.family,
    sex: person.sex,
    dateOfBirth: person.dob,
    nationalId: String(++ccNid),
    county: "Nairobi",
    ...DESK,
  });
  recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...DESK });

  // Spread across three cohorts so the cohort report has rows to compare.
  const monthsAgo = [10, 10, 7, 4, 4][index];
  const enrolledOn = inDays(-monthsAgo * 30);

  const id = enrol({
    programmeCode: "HIV",
    patientMrn: mrn,
    programmeNumber: person.ccc,
    enrolledOn,
    byUserId: clinicianId,
    byUserName: DOC.byUserName,
    deviceCode: REC,
  });
  enrolments.push(id);

  // Quarterly reviews up to now, each with the next one booked.
  for (let visit = 1; visit <= Math.floor(monthsAgo / 3); visit++) {
    const seen = inDays(-(monthsAgo - visit * 3) * 30);
    recordVisit({
      enrolmentId: id,
      visitDate: seen,
      // The last review books an appointment; for two people it has passed.
      nextDue: inDays(-(monthsAgo - (visit + 1) * 3) * 30),
      findings: {
        viralLoad: visit === 1 ? "Detectable, 840 copies/ml" : "Undetectable",
        adherence: index === 2 ? "Missed doses reported" : "Good",
      },
      note: visit === 1 ? "Started first-line. Counselled on adherence." : "Stable.",
      byUserId: clinicianId,
      byUserName: DOC.byUserName,
      deviceCode: REC,
    });
  }
}

// One transferred out, one lost — a cohort with no exits is not a real cohort.
recordOutcome({
  enrolmentId: enrolments[1],
  status: "transferred_out",
  outcomeOn: inDays(-45),
  note: "Moved to Nakuru. Transfer letter issued to PGH Nakuru CCC.",
  byUserId: clinicianId,
  byUserName: DOC.byUserName,
});
recordOutcome({
  enrolmentId: enrolments[2],
  status: "lost",
  outcomeOn: inDays(-20),
  note: "Three tracing attempts by telephone and one home visit. No contact.",
  byUserId: clinicianId,
  byUserName: DOC.byUserName,
});

// And a TB patient mid-course, so the second register is not empty.
const tbMrn = registerPatient({
  facilityId, deviceCode: REC, givenName: "Patrick", familyName: "Wafula",
  sex: "male", dateOfBirth: "1982-03-19", nationalId: String(++ccNid), county: "Nairobi", ...DESK,
});
recordConsent({ patientMrn: tbMrn, purpose: "treatment", granted: true, ...DESK });
const tbEnrolment = enrol({
  programmeCode: "TB", patientMrn: tbMrn, programmeNumber: "TB-2026-0117",
  enrolledOn: inDays(-75), byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: REC,
});
recordVisit({
  enrolmentId: tbEnrolment, visitDate: inDays(-45), nextDue: inDays(-16),
  findings: { sputum: "Negative", weightKg: 58 },
  note: "Two months of intensive phase complete. Converted.",
  byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: REC,
});

sweepDefaulters(facilityId);

// --------------------------------------------------- maternity & child health
//
// An antenatal clinic with the shape a real one has: women at every gestation,
// one whose blood pressure is rising and has raised an alert, one overdue for a
// contact, and deliveries behind them — including a caesarean and a low birth
// weight twin pair, because those are the numbers a maternity unit is judged on
// and a screen of uncomplicated normal deliveries proves nothing.
//
// Maternity is claimed inside the SHA package against the mother's own SHA
// number. Linda Mama, which used to pay for this separately, ended with NHIF.

const MOTHERS = [
  // given, family, weeks pregnant today, gravida, para
  { given: "Faith", family: "Wairimu", weeks: 12, gravida: 1, para: 0 },
  { given: "Mercy", family: "Adhiambo", weeks: 26, gravida: 3, para: 2 },
  { given: "Lydia", family: "Chepkoech", weeks: 34, gravida: 2, para: 1 },
  { given: "Beatrice", family: "Mwende", weeks: 38, gravida: 4, para: 3 },
];

let matNid = 43_000_000;
const MIDWIFE = { byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: REC };

const bookedMothers: { mrn: string; pregnancyId: string; weeks: number }[] = [];

for (const mother of MOTHERS) {
  const mrn = registerPatient({
    facilityId, deviceCode: REC, givenName: mother.given, familyName: mother.family,
    sex: "female", dateOfBirth: "1995-04-17", nationalId: String(++matNid), county: "Nairobi", ...DESK,
  });
  recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...DESK });

  // Booked at the first contact, which is where the dating comes from.
  const pregnancyId = bookPregnancy({
    patientMrn: mrn,
    lmp: inDays(-mother.weeks * 7),
    gravida: mother.gravida,
    para: mother.para,
    bookedOn: inDays(-(mother.weeks - 10) * 7),
    ...MIDWIFE,
  });
  bookedMothers.push({ mrn, pregnancyId, weeks: mother.weeks });

  // A contact roughly every six weeks since booking, with the last one booking
  // the next. Beatrice's is overdue, so the defaulter list is not empty.
  const contacts = Math.max(1, Math.floor((mother.weeks - 10) / 6));
  for (let contact = 1; contact <= contacts; contact++) {
    const weeksThen = 10 + contact * 6;
    const rising = mother.given === "Lydia" && contact === contacts;
    recordAncContact({
      pregnancyId,
      contactDate: inDays(-(mother.weeks - weeksThen) * 7),
      weightGrams: 58_000 + weeksThen * 300,
      systolic: rising ? 148 : 112 + contact * 2,
      diastolic: rising ? 96 : 72,
      fundalHeightCm: weeksThen,
      haemoglobin: contact === 1 ? 10.8 : 11.6,
      ttGiven: contact === 1,
      iptpGiven: weeksThen >= 16,
      ironGiven: true,
      llinGiven: contact === 1,
      hivTested: contact === 1,
      // Overdue on purpose for the woman at 38 weeks: she is the one a clinic
      // most needs to find, and she is the one most easily lost.
      nextDue: contact === contacts
        ? inDays(mother.given === "Beatrice" ? -9 : 14)
        : inDays(-(mother.weeks - weeksThen - 6) * 7),
      facilityId, ...MIDWIFE,
    });
  }
}

// Three women who have already delivered: a normal delivery, a caesarean with
// twins under 2500 g, and one that ended in a stillbirth. Each is booked and
// delivered in sequence so the dating on the record is real.
const DELIVERED = [
  {
    given: "Agnes", family: "Njoki", gestation: 39, mode: "spontaneous_vertex" as const, daysAgo: 12,
    bloodLossMl: 250,
    babies: [{ sex: "female" as const, birthWeightGrams: 3250, apgar1: 8, apgar5: 9, outcome: "live" as const }],
  },
  {
    given: "Sarah", family: "Kerubo", gestation: 35, mode: "caesarean" as const, daysAgo: 63,
    bloodLossMl: 620, complications: "Twin pregnancy, elective section at 35 weeks",
    babies: [
      { sex: "male" as const, birthWeightGrams: 2280, apgar1: 7, apgar5: 9, outcome: "live" as const },
      { sex: "female" as const, birthWeightGrams: 2150, apgar1: 7, apgar5: 8, outcome: "live" as const },
    ],
  },
  {
    given: "Purity", family: "Nduta", gestation: 33, mode: "spontaneous_vertex" as const, daysAgo: 21,
    bloodLossMl: 400, complications: "Reduced fetal movements on admission, no heartbeat found",
    babies: [{ sex: "male" as const, birthWeightGrams: 1900, outcome: "stillbirth_macerated" as const }],
  },
];

for (const record of DELIVERED) {
  const mrn = registerPatient({
    facilityId, deviceCode: REC, givenName: record.given, familyName: record.family,
    sex: "female", dateOfBirth: "1993-09-02", nationalId: String(++matNid), county: "Nairobi", ...DESK,
  });
  recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...DESK });

  // Dated so that the delivery falls at the gestation it is meant to.
  const lmp = inDays(-(record.gestation * 7 + record.daysAgo));
  const pregnancyId = bookPregnancy({
    patientMrn: mrn, lmp, gravida: 2, para: 1,
    bookedOn: inDays(-(record.gestation * 7 + record.daysAgo) + 12 * 7),
    ...MIDWIFE,
  });
  recordAncContact({
    pregnancyId, contactDate: inDays(-record.daysAgo - 42),
    systolic: 116, diastolic: 74, haemoglobin: 11.2,
    ttGiven: true, ironGiven: true, hivTested: true, llinGiven: true,
    facilityId, ...MIDWIFE,
  });

  const { deliveryId, babies } = recordDelivery({
    pregnancyId,
    deliveredAt: `${inDays(-record.daysAgo)}T04:20:00.000Z`,
    mode: record.mode,
    bloodLossMl: record.bloodLossMl,
    complications: record.complications,
    babies: record.babies,
    facilityId,
    byUserId: clinicianId,
    byUserName: DOC.byUserName,
    deviceCode: REC,
  });

  // The postnatal contacts that have fallen due since. Purity's second contact
  // records a danger sign, because the days after a loss are when a mother is
  // least likely to come back and most likely to need to.
  const daysSince = record.daysAgo;
  for (const [index, step] of PNC_SCHEDULE.entries()) {
    if (step.hoursAfter / 24 > daysSince) break;
    if (index > 2) break;
    recordPncContact({
      deliveryId,
      scheduledAt: step.label,
      contactDate: inDays(-daysSince + Math.floor(step.hoursAfter / 24)),
      motherFindings: index === 0 ? "Uterus well contracted, lochia normal" : "Recovering well",
      babyFindings: record.babies[0].outcome === "live" ? "Feeding well, cord clean" : "—",
      dangerSigns: record.given === "Purity" && index === 1 ? "Fever 38.9, offensive lochia" : undefined,
      nextDue: PNC_SCHEDULE[index + 1] ? inDays(-daysSince + Math.floor(PNC_SCHEDULE[index + 1].hoursAfter / 24)) : undefined,
      facilityId, ...MIDWIFE,
    });
  }

  // The babies' first vaccines, which is what gives the child health clinic a
  // card to work from at all.
  for (const baby of babies) {
    if (!baby.patientMrn) continue;
    recordImmunisation({
      patientMrn: baby.patientMrn, vaccineCode: "BCG", givenOn: inDays(-record.daysAgo),
      batchNumber: "BCG-2026-0411", site: "Left upper arm", ...MIDWIFE,
    });
    recordImmunisation({
      patientMrn: baby.patientMrn, vaccineCode: "OPV0", givenOn: inDays(-record.daysAgo),
      batchNumber: "OPV-2026-0388", site: "Oral", ...MIDWIFE,
    });
    // Sarah's twins are old enough for the six-week visit; one has had it and
    // one has not, so the child register shows both states.
    if (record.daysAgo >= 42 && baby === babies[0]) {
      for (const code of ["OPV1", "PCV1", "PENTA1", "ROTA1"]) {
        recordImmunisation({
          patientMrn: baby.patientMrn, vaccineCode: code, givenOn: inDays(-record.daysAgo + 42),
          batchNumber: `${code}-2026-0102`, site: "Left thigh", ...MIDWIFE,
        });
      }
    }
  }
}


// ------------------------------------------------------------------ casualty
//
// A road traffic collision, which is what a Kenyan casualty department
// actually deals with. Four casualties from one matatu, one of whom cannot say
// who she is and is identified by a relative an hour later; plus three walk-ins
// including one who gave up and went home, because a department that only
// records the patients it treated can never see that it is too slow.
//
// Nothing below performs a payer check, a deposit or a consent form before
// treatment, and that is the point: Article 43(2) of the Constitution.

const CAS = { byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: REC };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

let casNid = 45_000_000;
const casualtyPatient = (given: string, family: string, sex: "male" | "female", dob: string) => {
  const mrn = registerPatient({
    facilityId, deviceCode: REC, givenName: given, familyName: family, sex,
    dateOfBirth: dob, nationalId: String(++casNid), county: "Nairobi", ...DESK,
  });
  recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...DESK });
  return mrn;
};

const INCIDENT = declareIncident({
  facilityId,
  reference: "MCI-2026-014",
  kind: "Road traffic collision",
  description: "Matatu and lorry, Thika Road southbound. Four casualties by ambulance.",
  declaredAt: minutesAgo(95),
  byUserId: adminId,
  byUserName: "Facility Administrator",
});

// The critical one: taken straight through, no wait at all.
const crashCritical = openAttendance({
  facilityId, patientMrn: casualtyPatient("Daniel", "Kiprono", "male", "1990-06-14"),
  arrivalMode: "ambulance", arrivedAt: minutesAgo(92), incidentRef: INCIDENT,
  presenting: "Chest and abdominal injury, matatu passenger", ...CAS,
});
triagePatient({
  attendanceId: crashCritical, assessedAt: minutesAgo(90),
  observations: { mobility: "stretcher", respRate: 32, pulseBpm: 138, systolicMmhg: 76, tempTenthsC: 361, avpu: "pain", trauma: true },
  ...CAS,
});
startTreatment({ attendanceId: crashCritical, seenAt: minutesAgo(90), byUserId: clinicianId, byUserName: DOC.byUserName });
openMedicolegalCase({
  attendanceId: crashCritical, kind: "road_traffic", policeStation: "Kasarani",
  obNumber: "OB/118/2026", note: "Matatu passenger, Thika Road", ...CAS,
});
recordDisposition({
  attendanceId: crashCritical, disposition: "theatre", at: minutesAgo(62),
  note: "Laparotomy for free fluid on FAST", byUserId: clinicianId, byUserName: DOC.byUserName,
});

// The one who arrived without a name, and was identified by her sister.
const unknown = openUnidentified({
  facilityId, sex: "female", estimatedAge: 26, arrivalMode: "ambulance",
  arrivedAt: minutesAgo(91), incidentRef: INCIDENT,
  presenting: "Head injury, unresponsive at the scene", ...CAS,
});
triagePatient({
  attendanceId: unknown.attendanceId, assessedAt: minutesAgo(88),
  observations: { mobility: "stretcher", respRate: 24, pulseBpm: 112, systolicMmhg: 104, avpu: "voice", trauma: true },
  discriminator: "Head injury with reduced consciousness", discriminatorTriage: "red",
  ...CAS,
});
startTreatment({ attendanceId: unknown.attendanceId, seenAt: minutesAgo(86), byUserId: clinicianId, byUserName: DOC.byUserName });
identify({
  attendanceId: unknown.attendanceId,
  realPatientMrn: casualtyPatient("Winnie", "Akinyi", "female", "2000-03-22"),
  reason: "Her sister came to casualty and identified her by a scar and her clothing",
  deviceCode: REC, byUserId: adminId, byUserName: "Facility Administrator",
});

// Two walking wounded from the same crash, still waiting.
const crashWalking = [
  { given: "Peter", family: "Mwangi", dob: "1987-01-09", obs: { mobility: "with_help" as const, respRate: 22, pulseBpm: 104, systolicMmhg: 128, trauma: true } },
  { given: "Alice", family: "Njeri", dob: "1996-10-02", obs: { mobility: "walking" as const, respRate: 18, pulseBpm: 88, systolicMmhg: 118, trauma: true } },
];
for (const [index, person] of crashWalking.entries()) {
  const id = openAttendance({
    facilityId,
    patientMrn: casualtyPatient(person.given, person.family, index === 0 ? "male" : "female", person.dob),
    arrivalMode: "ambulance", arrivedAt: minutesAgo(90 - index * 2), incidentRef: INCIDENT,
    presenting: "Walking wounded, same collision", ...CAS,
  });
  triagePatient({ attendanceId: id, assessedAt: minutesAgo(85 - index * 2), observations: person.obs, ...CAS });
}

// A walk-in stabbing: a police case with a P3 already handed over.
const stabbing = openAttendance({
  facilityId, patientMrn: casualtyPatient("Brian", "Omondi", "male", "1998-12-30"),
  arrivalMode: "police", arrivedAt: minutesAgo(140), presenting: "Stab wound to the left arm", ...CAS,
});
triagePatient({
  attendanceId: stabbing, assessedAt: minutesAgo(138),
  observations: { mobility: "walking", respRate: 20, pulseBpm: 98, systolicMmhg: 122, trauma: true },
  discriminator: "Penetrating trauma", discriminatorTriage: "orange", ...CAS,
});
startTreatment({ attendanceId: stabbing, seenAt: minutesAgo(131), byUserId: clinicianId, byUserName: DOC.byUserName });
const stabCase = openMedicolegalCase({
  attendanceId: stabbing, kind: "stabbing", policeStation: "Kilimani", obNumber: "OB/94/2026", ...CAS,
});
issueP3({ caseId: stabCase, issuedTo: "PC Wanjala, Kilimani", byUserId: adminId, byUserName: "Facility Administrator" });
recordDisposition({
  attendanceId: stabbing, disposition: "discharged", at: minutesAgo(70),
  note: "Wound explored and sutured, tetanus given, review in 3 days",
  byUserId: clinicianId, byUserName: DOC.byUserName,
});

// Somebody who waited four hours and went home. This is the number a
// department needs to see, and a system that records only treated patients
// never shows it.
const gaveUp = openAttendance({
  facilityId, patientMrn: casualtyPatient("Susan", "Wanjiku", "female", "1979-05-18"),
  arrivalMode: "walk_in", arrivedAt: minutesAgo(300), presenting: "Ankle pain after a fall", ...CAS,
});
triagePatient({
  attendanceId: gaveUp, assessedAt: minutesAgo(295),
  observations: { mobility: "with_help", respRate: 16, pulseBpm: 82, systolicMmhg: 126, trauma: true }, ...CAS,
});
recordDisposition({
  attendanceId: gaveUp, disposition: "left_without_being_seen", at: minutesAgo(55),
  note: "Called three times at the 4pm round, not in the waiting area",
  byUserId: clinicianId, byUserName: DOC.byUserName,
});

// And one waiting right now with nobody having looked at her at all — the
// worst state a casualty board can be in, and the one the badge turns red for.
openAttendance({
  facilityId, patientMrn: casualtyPatient("Grace", "Muthoni", "female", "1992-08-11"),
  arrivalMode: "walk_in", arrivedAt: minutesAgo(18), presenting: "Severe abdominal pain", ...CAS,
});


// ----------------------------------------------------------------- referrals
//
// A level 2 clinic referring upwards, which is what this facility is. Five
// referrals in the states that matter: one accepted and travelling, one that
// came back with a proper counter-referral, one declined for want of a bed,
// one emergency still waiting for an answer past its target, and one that left
// three weeks ago and has never been heard of since.
//
// That last one is the module's whole point. It is also what every Kenyan
// clinic's referral book looks like, and no system currently shows it.

const REFER = { byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: REC };
const REFACT = { byUserId: clinicianId, byUserName: DOC.byUserName };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

let refNid = 47_000_000;
const referralPatient = (given: string, family: string, sex: "male" | "female", dob: string) => {
  const mrn = registerPatient({
    facilityId, deviceCode: REC, givenName: given, familyName: family, sex,
    dateOfBirth: dob, nationalId: String(++refNid), county: "Nairobi", ...DESK,
  });
  recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...DESK });
  return mrn;
};

// The one that worked: went, was treated, and the letter came back saying what
// this clinic is meant to continue.
const closedLoop = raiseReferral({
  facilityId, patientMrn: referralPatient("Samuel", "Gitonga", "male", "1968-04-11"),
  counterpartCode: "KNH-001", urgency: "urgent",
  reason: "Progressive weakness and a suspicious chest film",
  treatmentGiven: "Sputum sent, empirical amoxicillin started, oxygen saturation monitored",
  clinicalSummary: "Six weeks of cough and weight loss. HIV negative. Sputum smear negative twice.",
  serviceNeeded: "Respiratory medicine and CT",
  raisedAt: daysAgo(18), ...REFER,
});
acceptReferral({ referralId: closedLoop, acceptedByName: "Dr. Owino, medical registrar", at: daysAgo(18), ...REFACT });
departReferral({ referralId: closedLoop, transport: "County ambulance KCB 411X", escort: "Nurse Chebet", at: daysAgo(17), ...REFACT });
confirmArrival({ referralId: closedLoop, at: daysAgo(17), ...REFACT });
recordReferralOutcome({
  referralId: closedLoop, outcome: "treated_returned", at: daysAgo(6),
  note: "Bronchoscopy: smear-negative pulmonary TB confirmed on GeneXpert. Started on RHZE, day 9 of intensive phase. Continue DOT here, review sputum at two months, weigh monthly.",
  outcomeByName: "Dr. Mwangi, KNH respiratory unit", ...REFACT,
});

// Travelling now.
const travelling = raiseReferral({
  facilityId, patientMrn: referralPatient("Ruth", "Wanjala", "female", "1985-11-27"),
  counterpartCode: "MAMA-LUCY-01", urgency: "urgent",
  reason: "Obstructed labour, needs a caesarean",
  treatmentGiven: "IV line, fluids, catheter, fetal heart monitored, theatre alerted",
  serviceNeeded: "Emergency obstetrics",
  raisedAt: daysAgo(0), ...REFER,
});
acceptReferral({ referralId: travelling, acceptedByName: "Sister Adhiambo, labour ward", ...REFACT });
departReferral({ referralId: travelling, transport: "Facility ambulance", escort: "Nurse Chebet", ...REFACT });

// Declined for want of a bed. The patient is still here.
const declined = raiseReferral({
  facilityId, patientMrn: referralPatient("Joseph", "Kiplagat", "male", "1957-02-03"),
  counterpartCode: "MBAGATHI-01", urgency: "urgent",
  reason: "Decompensated heart failure, needs admission",
  treatmentGiven: "Frusemide 40mg IV, oxygen, sat upright, ECG done",
  serviceNeeded: "Medical admission",
  raisedAt: daysAgo(0), ...REFER,
});
declineReferral({ referralId: declined, reason: "No medical bed until Thursday — try Mama Lucy", ...REFACT });

// An emergency nobody has answered. Past its thirty-minute target.
raiseReferral({
  facilityId, patientMrn: referralPatient("Esther", "Nyaguthii", "female", "1991-07-19"),
  counterpartCode: "KNH-001", urgency: "emergency",
  reason: "Suspected ruptured ectopic pregnancy, shocked",
  treatmentGiven: "Two large-bore lines, 2L crystalloid, blood grouped and cross-matched, theatre here has no anaesthetist today",
  serviceNeeded: "Emergency laparotomy",
  raisedAt: new Date(Date.now() - 55 * 60_000).toISOString(), ...REFER,
});

// Gone three weeks, nothing heard. The list this module exists for.
const vanished = raiseReferral({
  facilityId, patientMrn: referralPatient("Peter", "Muriuki", "male", "1974-09-08"),
  counterpartCode: "KUTRRH-001", urgency: "routine",
  reason: "Newly diagnosed prostate cancer, for staging and oncology opinion",
  treatmentGiven: "PSA done, biopsy referred, catheter passed for retention",
  serviceNeeded: "Oncology",
  raisedAt: daysAgo(24), ...REFER,
});
acceptReferral({ referralId: vanished, acceptedByName: "Oncology booking office", at: daysAgo(23), ...REFACT });
departReferral({ referralId: vanished, transport: "Own means", at: daysAgo(22), ...REFACT });

// And one arriving here on somebody else's letter, so the receiving side is
// not an empty screen.
raiseReferral({
  facilityId, patientMrn: referralPatient("Mary", "Kamande", "female", "1999-01-14"),
  direction: "in", counterpartCode: "MATHARE-HC-01", urgency: "routine",
  reason: "Sent for the HIV comprehensive care clinic — they have no ART stock this month",
  serviceNeeded: "HIV care",
  raisedAt: daysAgo(2), ...REFER,
});


// ------------------------------------------------------------------- theatre
//
// The caesarean that casualty and maternity have both been pointing at, taken
// all the way through the WHO checklist, plus a case cancelled for the reason
// Kenyan theatres are cancelled for most often, and one where the count did
// not reconcile and had to be resolved.
//
// The checklist is answered item by item rather than ticked, because that is
// the mechanism: a checklist recorded as one tick is a checklist nobody read
// out loud.

const OT = { byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: REC };
const OTSIGN = { byUserId: clinicianId, byUserName: DOC.byUserName };

let otNid = 49_000_000;
const theatrePatient = (given: string, family: string, sex: "male" | "female", dob: string) => {
  const mrn = registerPatient({
    facilityId, deviceCode: REC, givenName: given, familyName: family, sex,
    dateOfBirth: dob, nationalId: String(++otNid), county: "Nairobi", ...DESK,
  });
  recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...DESK });
  return mrn;
};

const answerStage = (caseId: string, stage: Stage, overrides: Record<string, "yes" | "no" | "not_applicable"> = {}) => {
  for (const item of CHECKLIST[stage]) {
    answerChecklist({
      caseId, stage, itemCode: item.code,
      answer: overrides[item.code] ?? "yes",
      byUserId: clinicianId, byUserName: "Sister Adhiambo",
    });
  }
};

// The completed case. Everything done properly, which is what "good" looks
// like on the compliance figure.
const caesarean = bookCase({
  facilityId, patientMrn: theatrePatient("Janet", "Wangeci", "female", "1994-06-30"),
  theatreCode: "OT1", procedurePlanned: "Emergency caesarean section",
  urgency: "urgent", laterality: "not_applicable", source: "maternity",
  surgeonId: clinicianId, surgeonName: DOC.byUserName,
  estimatedMinutes: 45, asaGrade: 2,
  scheduledFor: `${today()}T07:30:00.000Z`, ...OT,
});
recordSurgicalConsent({
  caseId: caesarean,
  risksDiscussed: "Bleeding, infection, injury to bladder or bowel, need for hysterectomy, anaesthetic risk, risk to the baby",
  ...OTSIGN,
});
addTeamMember({ caseId: caesarean, role: "Surgeon", personName: DOC.byUserName, userId: clinicianId });
addTeamMember({ caseId: caesarean, role: "Anaesthetist", personName: "Dr. Kimathi" });
addTeamMember({ caseId: caesarean, role: "Scrub nurse", personName: "Sister Adhiambo" });
addTeamMember({ caseId: caesarean, role: "Circulating nurse", personName: "Nurse Chebet" });
arriveInTheatre({ caseId: caesarean, ...OTSIGN });
answerStage(caesarean, "sign_in");
completeStage({ caseId: caesarean, stage: "sign_in", ...OTSIGN });
startAnaesthesia({ caseId: caesarean, anaesthesia: "spinal", anaesthetistName: "Dr. Kimathi", ...OTSIGN });
answerStage(caesarean, "time_out");
completeStage({ caseId: caesarean, stage: "time_out", ...OTSIGN });
recordIncision({ caseId: caesarean, ...OTSIGN });
recordCountIn({ caseId: caesarean, item: "Swabs", count: 10, ...OTSIGN });
recordCountIn({ caseId: caesarean, item: "Needles", count: 4, ...OTSIGN });
recordCountIn({ caseId: caesarean, item: "Instruments", count: 32, ...OTSIGN });
closeCase({
  caseId: caesarean, procedurePerformed: "Emergency caesarean section",
  findings: "Live female infant 3100 g, Apgar 8 and 9. Uterus contracted well. No extension of the incision.",
  bloodLossMl: 600, specimen: "Placenta for histology", ...OTSIGN,
});
for (const [item, count] of [["Swabs", 10], ["Needles", 4], ["Instruments", 32]] as const) {
  recordCountOut({ caseId: caesarean, item, count, ...OTSIGN });
}
answerStage(caesarean, "sign_out");
completeStage({ caseId: caesarean, stage: "sign_out", ...OTSIGN });
leaveTheatre({ caseId: caesarean, ...OTSIGN });
completeCase({ caseId: caesarean, ...OTSIGN });

// The one where the count did not reconcile and a swab was found. This is what
// the record is meant to look like afterwards: the discrepancy still visible,
// and how it was resolved beside it.
const laparotomy = bookCase({
  facilityId, patientMrn: theatrePatient("Anthony", "Mutiso", "male", "1981-03-17"),
  theatreCode: "OT1", procedurePlanned: "Diagnostic laparoscopy", urgency: "immediate",
  source: "casualty", surgeonId: clinicianId, surgeonName: DOC.byUserName,
  estimatedMinutes: 60, asaGrade: 3, scheduledFor: `${today()}T05:00:00.000Z`, ...OT,
});
recordSurgicalConsent({
  caseId: laparotomy,
  consentedProcedure: "Diagnostic laparoscopy, proceed to laparotomy if indicated",
  risksDiscussed: "Bleeding, conversion to open surgery, bowel injury, need for transfusion",
  ...OTSIGN,
});
addTeamMember({ caseId: laparotomy, role: "Surgeon", personName: DOC.byUserName, userId: clinicianId });
addTeamMember({ caseId: laparotomy, role: "Scrub nurse", personName: "Sister Adhiambo" });
arriveInTheatre({ caseId: laparotomy, ...OTSIGN });
// A "no" that was recorded rather than hidden: the site marker was missing.
answerStage(laparotomy, "sign_in", { SITE_MARKED: "no" });
answerChecklist({
  caseId: laparotomy, stage: "sign_in", itemCode: "SITE_MARKED", answer: "no",
  note: "Marker pen missing from the trolley. Site confirmed verbally with the patient and on the scan.",
  byUserId: clinicianId, byUserName: "Sister Adhiambo",
});
completeStage({ caseId: laparotomy, stage: "sign_in", ...OTSIGN });
startAnaesthesia({ caseId: laparotomy, anaesthesia: "general", anaesthetistName: "Dr. Kimathi", ...OTSIGN });
answerStage(laparotomy, "time_out");
completeStage({ caseId: laparotomy, stage: "time_out", ...OTSIGN });
recordIncision({ caseId: laparotomy, ...OTSIGN });
recordCountIn({ caseId: laparotomy, item: "Swabs", count: 12, ...OTSIGN });
closeCase({
  caseId: laparotomy,
  procedurePerformed: "Laparotomy and repair of small bowel perforation",
  findings: "Perforated ileum with 400 ml of purulent fluid. Converted to open. Peritoneal lavage, primary repair.",
  bloodLossMl: 350, complications: "Converted from laparoscopic to open", ...OTSIGN,
});
recordCountOut({ caseId: laparotomy, item: "Swabs", count: 11, ...OTSIGN });
resolveCount({
  caseId: laparotomy, item: "Swabs",
  resolution: "Twelfth swab found under the drape after a full search of the field and the floor. Recount correct. No imaging needed.",
  ...OTSIGN,
});
answerStage(laparotomy, "sign_out");
completeStage({ caseId: laparotomy, stage: "sign_out", ...OTSIGN });
leaveTheatre({ caseId: laparotomy, ...OTSIGN });

// On today's list, waiting.
const hernia = bookCase({
  facilityId, patientMrn: theatrePatient("Francis", "Njoroge", "male", "1966-12-05"),
  theatreCode: "OT1", procedurePlanned: "Right inguinal hernia repair, mesh",
  urgency: "elective", laterality: "right", surgeonId: clinicianId, surgeonName: DOC.byUserName,
  estimatedMinutes: 60, asaGrade: 2, scheduledFor: `${today()}T11:00:00.000Z`, ...OT,
});
recordSurgicalConsent({
  caseId: hernia,
  risksDiscussed: "Bleeding, infection, recurrence, chronic groin pain, injury to the cord structures",
  ...OTSIGN,
});

// And one not yet consented, so the list shows what a blocked case looks like.
bookCase({
  facilityId, patientMrn: theatrePatient("Alice", "Wangui", "female", "1990-02-21"),
  theatreCode: "OT2", procedurePlanned: "Excision of breast lump", urgency: "elective",
  laterality: "left", surgeonName: DOC.byUserName, estimatedMinutes: 30, asaGrade: 1,
  scheduledFor: `${today()}T13:00:00.000Z`, ...OT,
});

// Cancelled for the reason Kenyan theatres are cancelled for most often.
const cancelled = bookCase({
  facilityId, patientMrn: theatrePatient("Beatrice", "Achieng", "female", "1975-08-09"),
  theatreCode: "OT1", procedurePlanned: "Total abdominal hysterectomy", urgency: "elective",
  surgeonName: DOC.byUserName, estimatedMinutes: 120, asaGrade: 2,
  scheduledFor: `${today()}T09:00:00.000Z`, ...OT,
});
cancelCase({
  caseId: cancelled, category: "no_anaesthetist",
  reason: "The only anaesthetist was called to the emergency laparotomy and the list could not be covered",
  ...OTSIGN,
});


// ---------------------------------------------------------------- radiology
//
// Four studies covering the states that matter: a chest film with a critical
// finding that has been telephoned to a named clinician, an obstetric
// ultrasound needing no pregnancy check at all, a chest film on a woman who
// might be pregnant — escalated, not blocked, because a necessary film in a
// shocked patient is still the right film — and one waiting for a
// justification nobody has written yet.

const RAD = { byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: REC };
const RADAT = { facilityId, byUserId: clinicianId, byUserName: DOC.byUserName };

let radNid = 51_000_000;
const imagingPatient = (given: string, family: string, sex: "male" | "female", dob: string) => {
  const mrn = registerPatient({
    facilityId, deviceCode: REC, givenName: given, familyName: family, sex,
    dateOfBirth: dob, nationalId: String(++radNid), county: "Nairobi", ...DESK,
  });
  recordConsent({ patientMrn: mrn, purpose: "treatment", granted: true, ...DESK });
  return mrn;
};

const imagingRequest = (mrn: string, service: string, question: string) => {
  const enc = openEncounter({
    facilityId, patientMrn: mrn, kind: "outpatient",
    clinicianId, clinicianName: DOC.byUserName, deviceCode: REC,
  });
  addDiagnosis({ encounterId: enc, code: "CA40", byUserId: clinicianId, byUserName: DOC.byUserName, deviceCode: REC });
  return placeOrder({
    encounterId: enc, kind: "imaging", serviceCode: service, payerCode: "CASH",
    clinicalQuestion: question, deviceCode: REC,
    ordererId: clinicianId, ordererName: DOC.byUserName,
  });
};

// The one that matters: a tension pneumothorax found and telephoned.
const pneumothorax = openStudy({
  orderId: imagingRequest(
    imagingPatient("Charles", "Odhiambo", "male", "1972-11-04"),
    "IMG-CXR", "Sudden breathlessness after a fall — rule out pneumothorax",
  ),
  modality: "xray", bodyPart: "Chest", laterality: "not_applicable", ...RAD,
});
justifyStudy({
  studyId: pneumothorax,
  justification: "Sudden breathlessness with reduced air entry on the right. Decompression decision depends on it.",
  ...RADAT,
});
performStudy({
  studyId: pneumothorax, radiographerName: "Mr. Barasa",
  equipment: "Shimadzu mobile, casualty", doseUgyM2: 124, doseUsv: 92, images: 1, ...RADAT,
});
const criticalReport = reportStudy({
  studyId: pneumothorax, kind: "provisional",
  findings: "Large right-sided pneumothorax with a visible pleural edge and mediastinal shift to the left.",
  impression: "Tension pneumothorax — needs decompression now",
  critical: true, ...RADAT,
});
recordCommunication({
  reportId: criticalReport, communicatedTo: "Dr. Achieng Wanjiru, by telephone at the casualty desk",
  byUserId: clinicianId, byUserName: DOC.byUserName,
});
reportStudy({
  studyId: pneumothorax, kind: "final",
  findings: "Right-sided pneumothorax, now with an intercostal drain in situ and the lung re-expanded.",
  impression: "Treated pneumothorax, drain well sited", ...RADAT,
});

// An obstetric ultrasound. No ionising radiation, so no pregnancy question and
// no dose — which is the point of distinguishing the modalities at all.
const obstetric = openStudy({
  orderId: imagingRequest(
    imagingPatient("Lilian", "Kariuki", "female", "1996-05-22"),
    "IMG-USS-OBS", "Dating scan, uncertain last menstrual period",
  ),
  modality: "ultrasound", bodyPart: "Gravid uterus", laterality: "not_applicable", ...RAD,
});
justifyStudy({ studyId: obstetric, justification: "Pregnancy of uncertain dates, antenatal schedule depends on it", ...RADAT });
performStudy({ studyId: obstetric, radiographerName: "Mr. Barasa", equipment: "Mindray DC-40", images: 6, ...RADAT });
reportStudy({
  studyId: obstetric, kind: "final",
  findings: "Single live intrauterine pregnancy. Crown-rump length corresponds to 12 weeks and 3 days.",
  impression: "Viable intrauterine pregnancy at 12+3. Expected date of delivery revised accordingly.",
  ...RADAT,
});

// A film on a woman who might be pregnant. Escalated, and taken.
const possiblyPregnant = openStudy({
  orderId: imagingRequest(
    imagingPatient("Jane", "Muthoni", "female", "1998-01-30"),
    "IMG-CXR", "Road traffic collision, shocked — chest film before theatre",
  ),
  modality: "xray", bodyPart: "Chest", laterality: "not_applicable", ...RAD,
});
justifyStudy({
  studyId: possiblyPregnant,
  justification: "Shocked trauma patient going to theatre. The film changes the anaesthetic plan.",
  pregnancyCheck: "possible", pregnancyNote: "Last period uncertain, no test available before theatre",
  ...RADAT,
});
performStudy({
  studyId: possiblyPregnant, radiographerName: "Mr. Barasa",
  equipment: "Shimadzu mobile, casualty", doseUgyM2: 96, doseUsv: 71, images: 1,
  ...RADAT,
});
reportStudy({
  studyId: possiblyPregnant, kind: "final",
  findings: "No pneumothorax, no haemothorax. Fractures of the left fifth and sixth ribs. Lead shielding over the pelvis.",
  impression: "Rib fractures, no immediate thoracic emergency", ...RADAT,
});

// And one nobody has justified yet, so the worklist shows what blocked means.
openStudy({
  orderId: imagingRequest(
    imagingPatient("Simon", "Wekesa", "male", "1959-07-15"),
    "IMG-XRAY", "Chronic knee pain, query osteoarthritis",
  ),
  modality: "xray", bodyPart: "Right knee", laterality: "right", ...RAD,
});


// -------------------------------------------------------------- procurement
//
// One full chain done properly, and one invoice that does not match — which is
// the module's whole point. The second supplier invoiced for 1000 when 800
// arrived AND at a price nobody agreed, so the match catches both and says
// what is actually payable.
//
// Also a blocked supplier, because a facility that cannot stop buying from
// somebody has no procurement control at all.

const BUYER = { byUserId: adminId, byUserName: "Facility Administrator" };
const STOREMAN = { byUserId: pharmacistId, byUserName: "Grace Kimani" };
const CLERK = { byUserId: clinicianId, byUserName: DOC.byUserName };

// The requisition, raised by the storekeeper and approved by somebody else.
const quarterlyReq = raiseRequisition({
  facilityId, storeCode: "MAIN",
  reason: "Quarterly top-up — paracetamol and amoxicillin down to three weeks of cover",
  lines: [
    { productCode: "PARA-500", quantity: 20_000 },
    { productCode: "AMOX-500", quantity: 6_000 },
  ],
  byUserId: pharmacistId, byUserName: "Grace Kimani", deviceCode: REC,
});
for (const [supplier, total, lead] of [
  ["KEMSA", 1_960_000, 21],
  ["MEDS", 2_040_000, 7],
  ["SURGIPHARM", 2_210_000, 3],
] as const) {
  recordQuotation({ requisitionId: quarterlyReq, supplierCode: supplier, totalCents: total, leadDays: lead, ...CLERK, deviceCode: REC });
}
selectQuotation({
  requisitionId: quarterlyReq, supplierCode: "MEDS",
  reason: "KEMSA quoted 21 days and we have three weeks of cover — the cheapest here arrives too late",
  ...BUYER,
});
decideRequisition({ requisitionId: quarterlyReq, approve: true, note: "Approved against the reorder report", ...BUYER });

// The order that went right.
const cleanPo = issuePurchaseOrder({
  facilityId, supplierCode: "MEDS", storeCode: "MAIN", requisitionId: quarterlyReq,
  expectedOn: inDays(7),
  lines: [
    { productCode: "PARA-500", quantity: 20_000, unitCostCents: 80 },
    { productCode: "AMOX-500", quantity: 6_000, unitCostCents: 60 },
  ],
  byUserId: adminId, byUserName: "Facility Administrator", deviceCode: REC,
});
receiveDelivery({
  poId: cleanPo, deliveryNote: "MEDS-DN-88214",
  lines: [
    { productCode: "PARA-500", quantity: 20_000, batchNumber: "PARA-2026-09A", expiresOn: inDays(540) },
    { productCode: "AMOX-500", quantity: 6_000, batchNumber: "AMOX-2026-07B", expiresOn: inDays(400) },
  ],
  byUserId: pharmacistId, byUserName: "Grace Kimani", deviceCode: REC,
});
const cleanInvoice = recordInvoice({
  poId: cleanPo, invoiceNo: "MEDS-2026-4471", invoiceDate: today(), etimsNumber: "0060004471",
  lines: [
    { productCode: "PARA-500", quantity: 20_000, unitCostCents: 80 },
    { productCode: "AMOX-500", quantity: 6_000, unitCostCents: 60 },
  ],
  ...CLERK, deviceCode: REC,
});
runMatch({ invoiceId: cleanInvoice, facilityId, ...BUYER });
approveInvoice({ invoiceId: cleanInvoice, byUserId: adminId, byUserName: "Facility Administrator" });
payInvoice({ invoiceId: cleanInvoice, paymentRef: "EFT-2026-0917-001", ...BUYER });

// The one that did not. Short delivery and a price nobody agreed, on the same
// invoice — both of which the match catches without anybody reading it.
const shortPo = issuePurchaseOrder({
  facilityId, supplierCode: "SURGIPHARM", storeCode: "MAIN",
  expectedOn: inDays(-4),
  lines: [{ productCode: "ORS-1L", quantity: 1_000, unitCostCents: 3_000 }],
  byUserId: adminId, byUserName: "Facility Administrator", deviceCode: REC,
});
receiveDelivery({
  poId: shortPo, deliveryNote: "SP-DN-1190",
  lines: [{
    productCode: "ORS-1L", quantity: 800, batchNumber: "ORS-2026-04", expiresOn: inDays(300),
    rejected: 40, rejectReason: "Forty sachets water-damaged in transit",
  }],
  byUserId: pharmacistId, byUserName: "Grace Kimani", deviceCode: REC,
});
const badInvoice = recordInvoice({
  poId: shortPo, invoiceNo: "SP-2026-9012", invoiceDate: today(),
  // Invoiced for the full thousand, at 34 shillings rather than the agreed 30.
  lines: [{ productCode: "ORS-1L", quantity: 1_000, unitCostCents: 3_400 }],
  ...CLERK, deviceCode: REC,
});
runMatch({ invoiceId: badInvoice, facilityId, ...BUYER });

// An order still outstanding and already late, so the board is not all green.
issuePurchaseOrder({
  facilityId, supplierCode: "KEMSA", storeCode: "MAIN",
  expectedOn: inDays(-11),
  lines: [{ productCode: "AL-20-120", quantity: 400, unitCostCents: 18_000 }],
  byUserId: adminId, byUserName: "Facility Administrator", deviceCode: REC,
});

// A requisition waiting for somebody to approve.
raiseRequisition({
  facilityId, storeCode: "PHARM",
  reason: "Salbutamol inhalers — two left on the shelf",
  lines: [{ productCode: "SALB-INH", quantity: 40 }],
  byUserId: pharmacistId, byUserName: "Grace Kimani", deviceCode: REC,
});

blockSupplier({
  code: "SURGIPHARM",
  reason: "Short delivery invoiced in full at a price above the order, twice this quarter",
  ...BUYER,
});


// ------------------------------------------------------------- remittance
//
// A payment advice from SHA covering the submitted claims: most paid in full,
// one paid short with a real reason code, and one line the facility has no
// claim for — all three happen, and the third is the one a spreadsheet drops.

const submittedClaims = dbAll<{ id: string; reference: string; total_cents: number }>(
  `SELECT id, reference, total_cents FROM claims WHERE status = 'submitted' AND reference IS NOT NULL`,
);

if (submittedClaims.length > 0) {
  const adviceLines = submittedClaims.map((claim, index) =>
    index === 0
      ? {
          // Paid short. The reason is the asset: it is what the rejection
          // taxonomy ranks and what the next scrubber gate is built from.
          payerReference: claim.reference,
          claimedCents: claim.total_cents,
          paidCents: Math.round(claim.total_cents * 0.6),
          reasonCode: "E11",
          reason: "Service not covered under the member's package",
        }
      : { payerReference: claim.reference, claimedCents: claim.total_cents, paidCents: claim.total_cents },
  );

  // And a line for a claim this facility never submitted. A real event — a
  // mixed-up file at the payer — and it must be visible, not swallowed.
  adviceLines.push({ payerReference: "SHA-REF-90211", claimedCents: 0, paidCents: 180_000 });

  const advice = importRemittance({
    facilityId,
    payerCode: "SHA",
    reference: "PA-2026-0912",
    adviceDate: inDays(-3),
    statedTotalCents: adviceLines.reduce((sum, l) => sum + l.paidCents, 0),
    lines: adviceLines,
    byUserId: adminId,
    byUserName: "Claims Officer",
    deviceCode: REC,
  });

  reconcile({ remittanceId: advice.id, byUserId: adminId, byUserName: "Claims Officer" });
}

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


// ------------------------------------------------------------------ payroll
//
// Eight staff on the salaries a Kenyan level 2 clinic actually pays, run
// through the statutory deductions: PAYE on the bands, NSSF in two tiers, SHIF
// at 2.75% with a floor, and the housing levy at 1.5% matched by the employer.
//
// One of them has a SACCO recovery larger than what is left after the statutory
// deductions, so the run shows what capping looks like: the statutory
// deductions come out in full, the SACCO gets what remains, and the shortfall
// is reported rather than carried.

const PAYROLL_PERIOD = today().slice(0, 7);
const PAY_DATE = `${PAYROLL_PERIOD}-28`;
const HR = { byUserId: pharmacistId, byUserName: "Grace Kimani", deviceCode: REC };
const HRAPPROVE = { byUserId: adminId, byUserName: "Facility Administrator" };

// ⚠️ Illustrative salaries for a private level 2 clinic. A real facility loads
// its own, and they vary enormously between public and private.
const STAFF: [string, string, string, number, string][] = [
  ["Achieng", "Wanjiru", "Medical Officer", 12_000_000, "Clinical"],
  ["Joseph", "Otieno", "Records Officer", 3_200_000, "Front desk"],
  ["Grace", "Kimani", "Pharmacist", 6_500_000, "Pharmacy"],
  ["Samuel", "Mutiso", "Laboratory Technologist", 4_800_000, "Laboratory"],
  ["Mary", "Adhiambo", "Nurse", 4_200_000, "Outpatient"],
  ["Peter", "Barasa", "Radiographer", 5_200_000, "Imaging"],
  ["Esther", "Chebet", "Nurse", 3_900_000, "Maternity"],
  ["Daniel", "Mwangi", "Cleaner", 1_800_000, "Support"],
];

// Four of these are the same people as the system's users. Linking them is the
// whole point: a facility that keeps three lists of its staff ends up paying
// somebody who left and rostering somebody whose licence expired.
const STAFF_USERS: Record<string, number | null> = {
  Achieng: clinicianId,
  Joseph: receptionistId,
  Grace: pharmacistId,
  Samuel: labTechId,
};

let staffNo = 100;
const staffIds: Record<string, string> = {};
for (const [given, family, title, basic, department] of STAFF) {
  staffIds[given] = addEmployee({
    facilityId, payrollNo: `EMP-${++staffNo}`, givenName: given, familyName: family,
    userId: STAFF_USERS[given] ?? null,
    kraPin: `A0${staffNo}45678X`, nssfNo: `NSSF-${staffNo}`, shifNo: `SHIF-${staffNo}`,
    jobTitle: title, department, basicCents: basic,
    bankName: "Equity Bank", bankAccount: `0123456${staffNo}`,
    startedOn: "2024-01-15", ...HR,
  });
}

// House allowance is taxable; reimbursed transport is not. Getting that
// distinction wrong is the commonest payroll error there is.
addPayItem({
  employeeId: staffIds.Achieng, code: "HSE", name: "House allowance", kind: "allowance",
  amountCents: 3_000_000, taxable: true, startsOn: "2024-01-15", deviceCode: REC,
});
addPayItem({
  employeeId: staffIds.Achieng, code: "CALL", name: "On-call allowance", kind: "allowance",
  amountCents: 1_500_000, taxable: true, startsOn: "2024-01-15", deviceCode: REC,
});
addPayItem({
  employeeId: staffIds.Samuel, code: "TRANS", name: "Reimbursed transport", kind: "allowance",
  amountCents: 800_000, taxable: false, startsOn: "2024-01-15", deviceCode: REC,
});
addPayItem({
  employeeId: staffIds.Grace, code: "SACCO", name: "SACCO monthly contribution", kind: "deduction",
  amountCents: 1_500_000, startsOn: "2024-01-15", deviceCode: REC,
});
// More than is left after the statutory deductions — deliberately, so the run
// shows what capping looks like.
addPayItem({
  employeeId: staffIds.Daniel, code: "ADV", name: "Salary advance recovery", kind: "deduction",
  amountCents: 2_000_000, startsOn: "2024-01-15",
  note: "Advanced in August for school fees", deviceCode: REC,
});

const payrollRun = createPayrollRun({
  facilityId, period: PAYROLL_PERIOD, payDate: PAY_DATE, ...HR,
});
approveRun({ runId: payrollRun.runId, ...HRAPPROVE });
payRun({ runId: payrollRun.runId, paymentRef: `EFT-PAYROLL-${PAYROLL_PERIOD.replace("-", "")}`, ...HRAPPROVE });


// ----------------------------------------------------------------------- HR
//
// Contracts for everybody, leave over the coming weeks, and the case the
// module exists to handle: the only laboratory technologist asks for a week
// off. Nobody else holds a KMLTTB registration, so the approver has to say in
// writing how the work will be covered — and the facility is told.
//
// Also one lapsed registration, because a licence that expired last month is
// not a reminder: the access module has been refusing that person's licensed
// work since the day it went.

const HRBY = { byUserId: pharmacistId, byUserName: "Grace Kimani" };
const HRBOSS = { byUserId: adminId, byUserName: "Facility Administrator" };

for (const [given, id] of Object.entries(staffIds)) {
  issueContract({
    employeeId: id,
    kind: given === "Daniel" ? "fixed_term" : "permanent",
    startsOn: "2024-01-15",
    endsOn: given === "Daniel" ? inDays(45) : undefined,
    noticeDays: 30,
    terms: given === "Daniel" ? "Twelve-month renewable contract" : "Permanent and pensionable",
    signedOn: "2024-01-15",
    ...HRBY, deviceCode: REC,
  });
}

// The next Monday, so leave lands on clean working days.
const mondayIn = (weeks: number) => {
  const d = new Date(Date.now() + weeks * 7 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
};
const plusDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Ordinary leave, covered — there are two nurses.
const nurseLeave = requestLeave({
  employeeId: staffIds.Mary, leaveCode: "ANNUAL",
  startsOn: mondayIn(2), endsOn: plusDays(mondayIn(2), 4),
  reason: "Family visit upcountry", ...HRBY, deviceCode: REC,
});
decideLeave({
  requestId: nurseLeave.id, approve: true,
  coverEmployeeId: staffIds.Esther, coverNote: "Esther covering the outpatient list",
  ...HRBOSS,
});

// The one that matters: the only laboratory technologist.
const labLeave = requestLeave({
  employeeId: staffIds.Samuel, leaveCode: "ANNUAL",
  startsOn: mondayIn(4), endsOn: plusDays(mondayIn(4), 4),
  reason: "Annual leave, booked in January", ...HRBY, deviceCode: REC,
});
decideLeave({
  requestId: labLeave.id, approve: true,
  uncoveredAck: "No second KMLTTB registration at this facility. Samples to Mbagathi for the week, agreed with their laboratory manager. Stat malaria and glucose by rapid test on site.",
  ...HRBOSS,
});

// And one waiting for a decision, so the register is not all settled.
requestLeave({
  employeeId: staffIds.Joseph, leaveCode: "ANNUAL",
  startsOn: mondayIn(6), endsOn: plusDays(mondayIn(6), 9),
  reason: "Two weeks, wedding", ...HRBY, deviceCode: REC,
});

// A lapsed registration. The radiographer's KRB licence expired three weeks
// ago, so the access module has been refusing his licensed work since then —
// HR's job is that it never comes as news. Note that adding an OLDER licence
// to somebody who already holds a current one lapses nothing, which is why
// this is a person of his own rather than a second row against an existing
// one: only the latest licence per regulator counts.
const radiographerUser = createUser({
  facilityId, username: "p.barasa", name: "Peter Barasa", password: "ChangeMe123",
  roles: ["clinician"], byUserId: adminId, byUserName: "Facility Administrator",
});
recordLicence({
  userId: radiographerUser, regulator: "KRB", licenceNumber: "KRB-DEMO-3312",
  expiresOn: inDays(-21), byUserId: adminId, byUserName: "Facility Administrator",
});
run(`UPDATE employees SET user_id = ? WHERE id = ?`, radiographerUser, staffIds.Peter);

// A disciplinary case taken through notice and hearing, which is what makes it
// defensible at the tribunal.
const hrCase = openCase({
  employeeId: staffIds.Daniel, kind: "disciplinary",
  summary: "Repeated late arrival — four occasions in September",
  raisedOn: inDays(-14), ...HRBY, deviceCode: REC,
});
recordHearing({
  caseId: hrCase, notifiedOn: inDays(-10), heardOn: inDays(-5),
  accompaniedBy: "Fellow employee, as the Act allows", ...HRBOSS,
});
closeHrCase({
  caseId: hrCase, outcome: "written_warning",
  note: "Written warning, valid six months. Transport difficulty acknowledged; shift moved to the later start.",
  ...HRBOSS,
});

// ------------------------------------------------------------------ the ledger
//
// Everything above already happened. This turns it into books, without anybody
// choosing an account — and then proves the books agree with the till.
//
// The opening capital and the rent are posted by hand, because those are the
// entries that genuinely have no operational source. Everything else is
// derived.

const GL = { byUserId: adminId, byUserName: "Facility Administrator" };

postJournal({
  facilityId, entryDate: inDays(-90),
  narrative: "Opening capital introduced by the owner",
  lines: [
    { accountCode: "1030", debitCents: 2_500_000 },
    { accountCode: "3000", creditCents: 2_500_000 },
  ],
  ...GL,
});

postJournal({
  facilityId, entryDate: inDays(-3),
  narrative: "Rent and utilities for the month",
  lines: [
    { accountCode: "5200", debitCents: 180_000 },
    { accountCode: "1030", creditCents: 180_000 },
  ],
  ...GL,
});

// One posted against the wrong account and reversed, so the log shows what a
// correction looks like: two entries, both standing.
const misposted = postJournal({
  facilityId, entryDate: inDays(-2),
  narrative: "Staff advance",
  lines: [
    { accountCode: "5100", debitCents: 40_000 },
    { accountCode: "1010", creditCents: 40_000 },
  ],
  ...GL,
});
reverseJournal({
  journalId: misposted,
  reason: "An advance is a receivable, not a staff cost — re-entered against the right account",
  ...GL,
});

// And the whole day's operations, turned into journals in one pass.
const postedFromOps = postFromOperations({ facilityId, ...GL });


// ===================================================================== estate
//
// The equipment the rest of the day depends on: an autoclave whose pressure
// test has lapsed, a generator that will not start, and a vaccine fridge that
// spent part of the night at fourteen degrees.

const ESTATE = { byUserId: adminId, byUserName: "Facility Administrator" };
const ESTATE_DEV = { ...ESTATE, deviceCode: "REC1" };

// Vaccines in the fridge, so the excursion has something to ruin.
for (const [code, batch, days, quantity] of [
  ["BCG", "BCG-2411", 200, 40],
  ["PENTA", "PEN-2508", 260, 60],
  ["MEASLES-R", "MR-2503", 150, 30],
] as [string, string, number, number][]) {
  receiveStock({
    storeCode: "VACC", productCode: code, batchNumber: batch,
    expiresOn: inDays(days), quantity, unitCostCents: 0,
    reference: "KEPI issue", deviceCode: "REC1", ...ESTATE,
  });
}

const autoclave = assetByTag(facilityId, "OT-AC-01")!;
const pressureTest = schedulesFor(autoclave.id).find((x) => x.name === "Pressure vessel test")!;
// Backdate the pressure test so it has actually lapsed: the whole point of the
// module is what a facility sees when a blocking check is overdue, and a demo
// where everything is in date shows none of it.
run(
  `UPDATE maintenance_schedules SET last_done_on = ?, next_due_on = ? WHERE id = ?`,
  inDays(-400),
  inDays(-35),
  pressureTest.id,
);

// The X-ray QA survey, done and passed, with the certificate on the record.
const xray = assetByTag(facilityId, "RAD-01")!;
const qa = schedulesFor(xray.id).find((x) => x.kind === "calibration")!;
recordMaintenance({
  assetId: xray.id, scheduleId: qa.id, kind: "calibration", doneOn: inDays(-3),
  passed: true, performedBy: "KNRA-approved medical physicist",
  certificate: "QA/2026/0117", costCents: 45_000_00, ...ESTATE_DEV,
});

// The generator will not start. It is critical, so the facility is told.
const generator = assetByTag(facilityId, "GEN-01")!;
reportFault({
  assetId: generator.id,
  fault: "Will not crank — battery reads 9.4 V off load",
  reportedAt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
  ...ESTATE_DEV,
});

// The X-ray was repaired and the invoice was paid, on a machine still inside
// its three-year warranty. Nobody checked. The summary says so out loud,
// because saying it afterwards is the only time it can still be recovered.
const xrayFault = reportFault({
  assetId: xray.id, fault: "Collimator lamp failing intermittently",
  reportedAt: inDays(-9) + "T09:40:00.000Z", outOfService: false, ...ESTATE_DEV,
});
closeWorkOrder({
  workOrderId: xrayFault, status: "fixed",
  resolution: "Lamp and holder replaced",
  costCents: 31_500_00, assignedTo: "Shimadzu East Africa", ...ESTATE,
});

// The ambulance went in and came back, out of warranty and properly paid for.
const ambulance = assetByTag(facilityId, "AMB-01")!;
scheduleMaintenance({
  assetId: ambulance.id, kind: "service", name: "10,000 km service", everyDays: 120,
  lastDoneOn: inDays(-95), deviceCode: "REC1",
});
const ambulanceFault = reportFault({
  assetId: ambulance.id, fault: "Air conditioning not cooling the patient compartment",
  reportedAt: inDays(-4) + "T08:10:00.000Z", ...ESTATE_DEV,
});
closeWorkOrder({
  workOrderId: ambulanceFault, status: "fixed",
  resolution: "Regassed and condenser fan replaced",
  costCents: 22_000_00, assignedTo: "Toyota Kenya", ...ESTATE,
});

// The fridge: read morning and evening, as a facility should. Fine when it was
// locked up last night; fourteen degrees when it was opened this morning. The
// vaccines inside it are quarantined by the act of writing the reading down.
const coldChainAsset = assetByTag(facilityId, "CC-01")!.id;
recordTemperature({
  assetId: coldChainAsset, readingTenths: 45,
  takenAt: `${inDays(-1)}T19:40:00.000Z`, ...ESTATE,
});
const excursion = recordTemperature({
  assetId: coldChainAsset, readingTenths: 142,
  takenAt: `${today()}T06:05:00.000Z`, ...ESTATE,
});

// A month of depreciation, posted into the same ledger as everything else.
const depreciation = postDepreciation({ facilityId, period: today().slice(0, 7), ...ESTATE });

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
console.log(`  programmes        ${count(`SELECT COUNT(*) AS n FROM enrolments WHERE status = 'active'`)} on the registers · HIV retention ${cohortReport("HIV")[0]?.retentionPercent ?? 0}%`);
console.log(`  HR                ${hrSummary(facilityId).staff} staff · ${hrSummary(facilityId).leaveWaiting} leave waiting · ${hrSummary(facilityId).uncoveredLeave} approved uncovered · ${hrSummary(facilityId).lapsedLicences} lapsed registration`);
console.log(`  payroll           ${payrollSummary(facilityId).employees} staff · gross ${Math.round(payrollSummary(facilityId).monthlyGrossCents / 100)} KES · statutory ${Math.round(statutoryReturn(payrollRun.runId).totalRemittableCents / 100)} KES to remit${payrollRun.cappedEmployees ? ` · ${payrollRun.cappedEmployees} capped` : ""}`);
console.log(`  estate            ${assetSummary(facilityId).assets} assets · ${assetSummary(facilityId).blockingOverdue} blocked by an overdue check · ${assetSummary(facilityId).criticalDown} critical down · fridge excursion quarantined ${excursion.quarantined} batches · depreciation ${Math.round(depreciation.amountCents / 100)} KES`);
console.log(`  ledger            ${ledgerSummary(facilityId).journals} journals · trial balance ${ledgerSummary(facilityId).trialBalanceDifferenceCents === 0 ? "balanced" : "OUT"} · ${reconcileLedger(facilityId).agrees ? "agrees with the till" : "DISAGREES with the till"}`);
console.log(`  procurement       ${procurementSummary(facilityId).openOrders} orders open · ${procurementSummary(facilityId).queriedInvoices} invoice queried · ${Math.round(procurementSummary(facilityId).varianceCents / 100)} KES overcharged, caught`);
console.log(`  radiology         ${radiologySummary().studies} studies · ${radiologySummary().blocked} blocked · ${radiologySummary().totalDoseMsv} mSv delivered · ${radiologySummary().criticalUncommunicated} critical untold`);
console.log(`  theatre           ${theatreSummary(facilityId).booked} cases · checklist ${theatreSummary(facilityId).checklistCompliantPercent ?? 0}% complete · ${theatreSummary(facilityId).countMismatches} count mismatch resolved`);
console.log(`  referrals         ${referralSummary(facilityId).live} live · ${referralSummary(facilityId).loopBroken} never came back · loop closed ${referralSummary(facilityId).loopClosedPercent ?? 0}%`);
console.log(`  casualty          ${emergencySummary(facilityId).open} in the department · ${emergencySummary(facilityId).breached + emergencySummary(facilityId).untriaged} past target · ${emergencySummary(facilityId).withinTargetPercent ?? 0}% seen in time`);
console.log(`  maternity         ${maternitySummary().activePregnancies} pregnancies booked · ${maternitySummary().deliveries} deliveries · caesarean rate ${maternitySummary().caesareanRatePercent ?? 0}%`);
console.log(`  child health      ${count(`SELECT COUNT(*) AS n FROM births WHERE patient_mrn IS NOT NULL AND outcome = 'live'`)} babies with their own file · ${count(`SELECT COUNT(*) AS n FROM immunisations`)} vaccines given`);
console.log(`  MOH returns       ${count(`SELECT COUNT(*) AS n FROM moh_returns`)} generated, ${count(`SELECT COUNT(*) AS n FROM moh_returns WHERE status = 'submitted'`)} submitted`);
console.log(`  taken today       ${Math.round(takings(facilityId).reduce((sum, t) => sum + t.netCents, 0) / 100)} KES`);
console.log(`  owed              ${Math.round(outstandingInvoices(facilityId).reduce((sum, o) => sum + o.balanceCents, 0) / 100)} KES across ${outstandingInvoices(facilityId).length} invoices`);
console.log(`  claims            ${summary.total} · acceptance ${summary.acceptanceRatePercent}%`);
console.log(`  recovered         ${Math.round(reconciliation(facilityId).paidCents / 100)} KES of ${Math.round(reconciliation(facilityId).submittedCents / 100)} KES claimed`);
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

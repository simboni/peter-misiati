/**
 * M26 Maternity and Child Health.
 *
 * The rules this module exists to hold: a pregnancy is dated or it is refused,
 * a raised blood pressure reaches somebody today, and every live baby leaves
 * the delivery room with a file number of their own. Twins are two children,
 * not one line on the mother's record.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-mat-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const M = await import("../src/lib/maternity.ts");
const P = await import("../src/lib/patients.ts");
const N = await import("../src/lib/notifications.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, get } = await import("../src/lib/db.ts");

const { facilityId, adminId, clinicianId, receptionistId } = seedDemo();
registerDevice({ facilityId, code: "MAT1", label: "Maternity", byUserId: adminId, byUserName: "admin" });
M.seedImmunisationSchedule();

const DEV = "MAT1";
const BY = { byUserId: clinicianId, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV };
const CLINIC = { facilityId, ...BY };

let nid = 87_000_000;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const today = () => day(0);

function newMother(given: string, sex: "male" | "female" = "female"): string {
  return P.registerPatient({
    facilityId, deviceCode: DEV, givenName: given, familyName: "Wambui", sex,
    nationalId: String(++nid), byUserId: receptionistId, byUserName: "Joseph Otieno",
  });
}

/** A pregnancy dated so that today falls at roughly `weeks` gestation. */
function bookAt(mrn: string, weeks: number, extra: Record<string, unknown> = {}): string {
  return M.bookPregnancy({ patientMrn: mrn, lmp: day(-weeks * 7), ...BY, ...extra });
}

// =================================================================== dating

test("the expected date is the last period plus 280 days, and says so", () => {
  const { edd, source } = M.expectedDate({ lmp: "2026-01-01", edd_override: null, edd_source: "lmp" });
  assert.equal(edd, "2026-10-08", "Naegele's rule: 1 Jan + 280 days");
  assert.equal(source, "lmp");
});

test("a scan overrides the dates, and the record shows which was used", () => {
  const byScan = M.expectedDate({ lmp: "2026-01-01", edd_override: "2026-10-20", edd_source: "scan" });
  assert.equal(byScan.edd, "2026-10-20");
  assert.equal(byScan.source, "scan", "a screen must be able to say 'by scan' rather than show a bare number");
});

test("an undated pregnancy has no gestation rather than a wrong one", () => {
  assert.equal(M.gestationWeeks({ lmp: null, edd_override: null, edd_source: "unknown" }), null);
});

test("gestation counts completed weeks from the notional start", () => {
  const p = { lmp: "2026-01-01", edd_override: null, edd_source: "lmp" as const };
  assert.equal(M.gestationWeeks(p, "2026-01-01"), 0);
  assert.equal(M.gestationWeeks(p, "2026-01-14"), 1, "13 days is one completed week, not two");
  assert.equal(M.gestationWeeks(p, "2026-01-15"), 2);
  assert.equal(M.gestationWeeks(p, "2026-10-08"), 40, "the expected date is forty weeks");
});

// ================================================================== booking

test("a pregnancy without a date is refused at booking, where it is cheapest to fix", () => {
  const mrn = newMother("Undated");
  assert.throws(
    () => M.bookPregnancy({ patientMrn: mrn, ...BY }),
    /cannot be scheduled or assessed/,
  );
});

test("a last period in the future is refused", () => {
  const mrn = newMother("Futuredates");
  assert.throws(() => M.bookPregnancy({ patientMrn: mrn, lmp: day(30), ...BY }), /in the future/);
});

test("para above gravida is refused — she cannot have delivered more often than conceived", () => {
  const mrn = newMother("Impossible");
  assert.throws(
    () => M.bookPregnancy({ patientMrn: mrn, lmp: day(-70), gravida: 2, para: 3, ...BY }),
    /para cannot exceed gravida/,
  );
});

test("a second open pregnancy is refused — two schedules and two claims for one delivery", () => {
  const mrn = newMother("Twicebooked");
  bookAt(mrn, 10);
  assert.throws(() => bookAt(mrn, 10), /already has an open pregnancy/);
});

test("a booking carries the payer's own cover reference, whatever the scheme calls it", () => {
  // Deliberately not a Linda Mama number: that scheme ended with NHIF when SHA
  // took over. Maternity is claimed against the mother's SHA number now, and
  // this column is only for a payer that issues its own reference.
  const mrn = newMother("Covered");
  const id = bookAt(mrn, 12, { coverRef: "sha-auth-4471", gravida: 2, para: 1 });
  const p = M.getPregnancy(id)!;
  assert.equal(p.cover_ref, "SHA-AUTH-4471", "stored the way it will be matched — upper case, trimmed");
  assert.equal(p.status, "booked");
  assert.equal(M.openPregnancyFor(mrn)!.id, id);
});

// ================================================================ antenatal

test("a contact stamps the gestation as it was on the day, not as it is now", () => {
  const mrn = newMother("Stamped");
  const id = bookAt(mrn, 20);
  const c = M.recordAncContact({ pregnancyId: id, contactDate: today(), weightGrams: 64_000, ...CLINIC });
  assert.equal(c.contactNumber, 1);
  assert.equal(c.gestationWeeks, 20);
  assert.equal(M.ancContactsFor(id)[0].gestation_weeks, 20, "read back from the row, not recomputed");
});

test("a contact before the booking is refused", () => {
  const mrn = newMother("Backdated");
  const id = bookAt(mrn, 8);
  assert.throws(
    () => M.recordAncContact({ pregnancyId: id, contactDate: day(-30), ...CLINIC }),
    /cannot be before the booking/,
  );
});

test("a blood pressure written the wrong way round is refused, not stored", () => {
  const mrn = newMother("Reversed");
  const id = bookAt(mrn, 16);
  assert.throws(
    () => M.recordAncContact({ pregnancyId: id, systolic: 80, diastolic: 120, ...CLINIC }),
    /wrong way round/,
  );
});

test("a raised blood pressure reaches a clinician today, not on the next round", () => {
  const mrn = newMother("Preeclamptic");
  const id = bookAt(mrn, 32);
  const c = M.recordAncContact({ pregnancyId: id, systolic: 152, diastolic: 98, ...CLINIC });
  assert.equal(c.escalated, true);

  const raised = N.inbox(facilityId, "clinician").find((n) => n.entity_id === id && n.kind === "anc_danger");
  assert.ok(raised, "the contact is recorded and a critical notification is raised with it");
  assert.equal(raised!.severity, "critical");
  assert.match(raised!.subject, /152\/98/);
});

test("severe anaemia escalates on the haemoglobin alone", () => {
  const mrn = newMother("Anaemic");
  const id = bookAt(mrn, 28);
  const c = M.recordAncContact({ pregnancyId: id, haemoglobin: 6.4, ironGiven: true, ...CLINIC });
  assert.equal(c.escalated, true);
  assert.equal(M.ancContactsFor(id)[0].haemoglobin_milli, 6400, "stored in thousandths like every other result");
});

test("an ordinary contact escalates nothing", () => {
  const mrn = newMother("Wellwoman");
  const id = bookAt(mrn, 24);
  const c = M.recordAncContact({ pregnancyId: id, systolic: 118, diastolic: 74, haemoglobin: 11.8, ...CLINIC });
  assert.equal(c.escalated, false);
});

test("the schedule says which contact is next and at what gestation", () => {
  const mrn = newMother("Scheduled");
  const id = bookAt(mrn, 12);
  assert.deepEqual(M.nextAncContact(id), { number: 1, atWeeks: M.ANC_CONTACT_WEEKS[0] });
  M.recordAncContact({ pregnancyId: id, ...CLINIC });
  assert.deepEqual(M.nextAncContact(id), { number: 2, atWeeks: M.ANC_CONTACT_WEEKS[1] });
});

test("a woman overdue for her next contact appears on the defaulter list", () => {
  const mrn = newMother("Overdue");
  const id = bookAt(mrn, 22);
  M.recordAncContact({ pregnancyId: id, nextDue: day(-14), ...CLINIC });

  const overdue = M.ancDefaulters().find((d) => d.pregnancy_id === id);
  assert.ok(overdue, "a missed antenatal contact is found, not waited for");
  assert.match(overdue!.patient_name, /Overdue/);
});

test("only the latest contact counts — an old next-due that has been superseded is not a default", () => {
  const mrn = newMother("Caughtup");
  const id = bookAt(mrn, 26, { bookedOn: day(-40) });
  M.recordAncContact({ pregnancyId: id, contactDate: day(-20), nextDue: day(-6), ...CLINIC });
  M.recordAncContact({ pregnancyId: id, contactDate: today(), nextDue: day(28), ...CLINIC });
  assert.equal(M.ancDefaulters().find((d) => d.pregnancy_id === id), undefined);
});

// =================================================================== birth

test("a delivery must record at least one baby, even a stillbirth", () => {
  const mrn = newMother("Nobabies");
  const id = bookAt(mrn, 39);
  assert.throws(
    () => M.recordDelivery({ pregnancyId: id, mode: "spontaneous_vertex", babies: [], facilityId, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV }),
    /at least one baby/,
  );
});

test("a live baby leaves the delivery room with a file number of their own", () => {
  const mrn = newMother("Delivered");
  const id = bookAt(mrn, 39);
  const { babies } = M.recordDelivery({
    pregnancyId: id, mode: "spontaneous_vertex", bloodLossMl: 250,
    babies: [{ sex: "female", birthWeightGrams: 3200, apgar1: 8, apgar5: 9, outcome: "live" }],
    facilityId, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });

  assert.equal(babies.length, 1);
  const babyMrn = babies[0].patientMrn!;
  assert.ok(babyMrn, "without their own record a newborn cannot be immunised or weighed");

  const baby = P.resolvePatient(babyMrn)!;
  assert.equal(baby.family_name, "Wambui", "the mother's family name");
  assert.match(baby.given_name, /^Baby of /, "named the way a ward actually writes it until the family names them");
  assert.equal(baby.date_of_birth, today());
});

test("twins are two children and two records", () => {
  const mrn = newMother("Twinmother");
  const id = bookAt(mrn, 36);
  const { deliveryId, babies } = M.recordDelivery({
    pregnancyId: id, mode: "caesarean",
    babies: [
      { sex: "male", birthWeightGrams: 2400, outcome: "live" },
      { sex: "female", birthWeightGrams: 2300, outcome: "live" },
    ],
    facilityId, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });

  assert.equal(babies.length, 2);
  assert.notEqual(babies[0].patientMrn, babies[1].patientMrn, "two file numbers, not one");
  // Two children called "Baby of Twinmother" on a ward list is how the wrong
  // one gets weighed.
  assert.equal(P.resolvePatient(babies[0].patientMrn!)!.given_name, "Twin 1 of Twinmother");
  assert.equal(P.resolvePatient(babies[1].patientMrn!)!.given_name, "Twin 2 of Twinmother");

  const rows = M.birthsFor(deliveryId);
  assert.deepEqual(rows.map((r) => r.birth_order), [1, 2]);

  const lbw = N.inbox(facilityId, "clinician").filter(
    (n) => n.kind === "low_birth_weight" && n.entity_id === deliveryId,
  );
  assert.equal(lbw.length, 2, "both babies are under 2500 g and both are flagged");
});

test("a stillbirth is recorded without registering a patient", () => {
  const mrn = newMother("Bereaved");
  const id = bookAt(mrn, 34);
  const { deliveryId, babies } = M.recordDelivery({
    pregnancyId: id, mode: "spontaneous_vertex",
    babies: [{ sex: "male", birthWeightGrams: 2100, outcome: "stillbirth_fresh" }],
    facilityId, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });
  assert.equal(babies[0].patientMrn, null, "no file is opened for a baby who did not live");
  assert.equal(M.birthsFor(deliveryId)[0].outcome, "stillbirth_fresh");
});

test("delivering closes the pregnancy, and a closed pregnancy cannot deliver twice", () => {
  const mrn = newMother("Closedout");
  const id = bookAt(mrn, 40);
  const deliver = () =>
    M.recordDelivery({
      pregnancyId: id, mode: "spontaneous_vertex",
      babies: [{ sex: "female", birthWeightGrams: 3400, outcome: "live" }],
      facilityId, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV,
    });
  deliver();
  assert.equal(M.getPregnancy(id)!.status, "delivered");
  assert.throws(deliver, /already recorded as delivered/);
});

test("a delivered pregnancy takes no further antenatal contacts", () => {
  const mrn = newMother("Postdelivery");
  const id = bookAt(mrn, 40);
  M.recordDelivery({
    pregnancyId: id, mode: "spontaneous_vertex",
    babies: [{ sex: "male", birthWeightGrams: 3100, outcome: "live" }],
    facilityId, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });
  assert.throws(() => M.recordAncContact({ pregnancyId: id, ...CLINIC }), /recorded as delivered/);
});

test("closing a pregnancy that did not reach delivery must record why", () => {
  const mrn = newMother("Miscarried");
  const id = bookAt(mrn, 9);
  assert.throws(
    () => M.closePregnancy({ pregnancyId: id, status: "miscarried", note: "   ", ...BY }),
    /must record why/,
  );
  M.closePregnancy({ pregnancyId: id, status: "miscarried", note: "Loss at 9 weeks, managed conservatively", ...BY });
  assert.equal(M.getPregnancy(id)!.status, "miscarried");
  assert.equal(M.openPregnancyFor(mrn), undefined, "and she can be booked again");
});

// =============================================================== postnatal

test("a postnatal danger sign is critical — most maternal deaths are in these days", () => {
  const mrn = newMother("Postnatal");
  const id = bookAt(mrn, 39);
  const { deliveryId } = M.recordDelivery({
    pregnancyId: id, mode: "spontaneous_vertex",
    babies: [{ sex: "female", birthWeightGrams: 3050, outcome: "live" }],
    facilityId, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });

  M.recordPncContact({
    deliveryId, scheduledAt: M.PNC_SCHEDULE[0].label,
    motherFindings: "Uterus well contracted", babyFindings: "Feeding well", ...CLINIC,
  });
  M.recordPncContact({
    deliveryId, scheduledAt: M.PNC_SCHEDULE[1].label,
    dangerSigns: "Heavy bleeding, soaking a pad an hour", ...CLINIC,
  });

  assert.equal(M.pncContactsFor(deliveryId).length, 2);
  const alert = N.inbox(facilityId, "clinician").find((n) => n.kind === "pnc_danger" && n.entity_id === deliveryId);
  assert.ok(alert);
  assert.equal(alert!.severity, "critical");
});

// ============================================================ immunisation

test("the childhood schedule is data, not code", () => {
  const codes = M.immunisationSchedule().map((v) => v.code);
  assert.ok(codes.includes("BCG"));
  assert.ok(codes.includes("MR2"));
  assert.equal(M.immunisationSchedule()[0].due_weeks, 0, "ordered by when it falls due");
  assert.match(M.immunisationSchedule()[0].source, /KEPI/, "every row carries where it came from");
});

test("a vaccine not on the schedule is refused rather than invented", () => {
  const mrn = newMother("Vaccinee");
  assert.throws(
    () => M.recordImmunisation({ patientMrn: mrn, vaccineCode: "NOTAVACCINE", ...BY }),
    /is not on the immunisation schedule/,
  );
});

test("a repeat dose is refused — it is a reportable event, not a second row", () => {
  const mrn = newMother("Doubledosed");
  M.recordImmunisation({ patientMrn: mrn, vaccineCode: "BCG", batchNumber: "BCG-2291", ...BY });
  assert.throws(
    () => M.recordImmunisation({ patientMrn: mrn, vaccineCode: "bcg", ...BY }),
    /already given on .*reportable event/s,
  );
});

test("the card is built from the child's own date of birth, and marks what is overdue", () => {
  const mrn = newMother("Cardmother");
  const id = bookAt(mrn, 39);
  const { babies } = M.recordDelivery({
    pregnancyId: id, mode: "spontaneous_vertex",
    babies: [{ sex: "female", birthWeightGrams: 3300, outcome: "live" }],
    facilityId, byUserId: clinicianId!, byUserName: "Dr. Achieng Wanjiru", deviceCode: DEV,
  });
  const babyMrn = babies[0].patientMrn!;

  M.recordImmunisation({ patientMrn: babyMrn, vaccineCode: "BCG", batchNumber: "BCG-2291", ...BY });

  // Read the card as it will look when the child is ten weeks old.
  const card = M.immunisationCard(babyMrn, day(70));
  const bcg = card.find((v) => v.code === "BCG")!;
  const penta1 = card.find((v) => v.code === "PENTA1")!;
  const mr1 = card.find((v) => v.code === "MR1")!;

  assert.equal(bcg.givenOn, today());
  assert.equal(bcg.overdue, false);
  assert.equal(penta1.dueOn, day(42), "six weeks after this baby's own birth");
  assert.equal(penta1.overdue, true, "due at six weeks, not given, and the child is ten weeks old");
  assert.equal(mr1.overdue, false, "measles at nine months is not yet due");
});

// =================================================================== report

test("the summary counts the things a maternity unit is judged on", () => {
  const s = M.maternitySummary();
  assert.ok(s.deliveries >= 6);
  assert.ok(s.liveBirths >= 6);
  assert.ok(s.stillbirths >= 1);
  assert.ok(s.caesareans >= 1);
  assert.ok(s.lowBirthWeight >= 2);
  assert.equal(
    s.caesareanRatePercent,
    Math.round((s.caesareans / s.deliveries) * 1000) / 10,
    "the caesarean rate every referral hospital is asked about",
  );
  assert.equal(s.stillbirthRatePer1000, Math.round((s.stillbirths / (s.liveBirths + s.stillbirths)) * 1000));
});

test("the summary reports a rate as absent rather than zero when there were no deliveries", () => {
  const s = M.maternitySummary("1990-01-01", "1990-12-31");
  assert.equal(s.deliveries, 0);
  assert.equal(s.caesareanRatePercent, null, "no deliveries is not a zero per cent caesarean rate");
  assert.equal(s.stillbirthRatePer1000, null);
});

// ==================================================================== audit

test("a pregnancy cannot be booked against a patient recorded as male", () => {
  const mrn = newMother("Malepatient", "male");
  assert.throws(() => bookAt(mrn, 10), /recorded as female/);
});

test("everything maternity did is on the audit chain, and the chain still verifies", () => {
  const booked = get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'pregnancy_booked'`)!.n;
  const deliveries = get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'delivery_recorded'`)!.n;
  assert.ok(booked >= 10);
  assert.ok(deliveries >= 6);

  const v = verifyAuditChain();
  assert.equal(v.ok, true, "the hash chain covers the maternity writes too");
});

test("the next contact is chosen by gestation, not by counting contacts", () => {
  // Four contacts done, but she is 38 weeks. Counting would say "contact 5, at
  // 34 weeks" — a schedule nobody is on.
  const mrn = newMother("Latebooker");
  const id = bookAt(mrn, 38, { bookedOn: day(-22 * 7) });
  for (const weeksThen of [16, 22, 28, 34]) {
    M.recordAncContact({ pregnancyId: id, contactDate: day(-(38 - weeksThen) * 7), ...CLINIC });
  }
  const next = M.nextAncContact(id)!;
  assert.equal(next.number, 5);
  assert.equal(next.atWeeks, 38, "the first scheduled contact that is not already behind her");
});

test("the schedule never runs backwards past the last contact", () => {
  const mrn = newMother("Ontime");
  const id = bookAt(mrn, 20, { bookedOn: day(-8 * 7) });
  M.recordAncContact({ pregnancyId: id, contactDate: day(-8 * 7), ...CLINIC });
  const next = M.nextAncContact(id)!;
  assert.equal(next.atWeeks, 20, "she is 20 weeks now; the 12-week contact is behind her");
});

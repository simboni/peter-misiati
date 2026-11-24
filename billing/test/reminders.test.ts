import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSchedule,
  daysBetween,
  dueStep,
  toneForStep,
  reminderCopy,
  whatsappCopy,
  isChaseable,
  isTooOldToAutoChase,
} from "../src/server/reminders";

const d = (s: string) => new Date(s + "T09:00:00Z");

test("parseSchedule sorts, dedupes and rejects nonsense", () => {
  assert.deepEqual(parseSchedule("-3,0,3,7,14"), [-3, 0, 3, 7, 14]);
  assert.deepEqual(parseSchedule(" 7 , 0 , 7 , -3 "), [-3, 0, 7]);
  assert.deepEqual(parseSchedule("abc,,1.5,9999,-999"), []);
  assert.deepEqual(parseSchedule(""), []);
});

test("daysBetween counts calendar days, not elapsed hours", () => {
  // 23:00 to 01:00 the next day is 2 hours but one calendar day — an invoice
  // due "yesterday" is one day overdue however late in the evening it was due.
  assert.equal(daysBetween(new Date("2026-03-01T23:00:00"), new Date("2026-03-02T01:00:00")), 1);
  assert.equal(daysBetween(d("2026-03-01"), d("2026-03-01")), 0);
  assert.equal(daysBetween(d("2026-03-10"), d("2026-03-01")), -9);
});

const schedule = [-3, 0, 3, 7, 14];

test("the first step fires exactly 3 days before due, and not earlier", () => {
  // schedule starts at -3, so for a 10 Mar due date that is 7 Mar.
  assert.equal(dueStep({ dueDate: d("2026-03-10"), now: d("2026-03-07"), schedule, sent: [] }), -3);
  assert.equal(dueStep({ dueDate: d("2026-03-10"), now: d("2026-03-05"), schedule, sent: [] }), null);
  assert.equal(dueStep({ dueDate: d("2026-03-10"), now: d("2026-03-01"), schedule, sent: [] }), null);
});

test("the due-day step fires on the due date", () => {
  assert.equal(dueStep({ dueDate: d("2026-03-10"), now: d("2026-03-10"), schedule, sent: [-3] }), 0);
});

test("only the LATEST passed step fires, never a backlog", () => {
  // 20 days overdue, never chased: one message about 14 days, not four messages.
  assert.equal(dueStep({ dueDate: d("2026-03-01"), now: d("2026-03-21"), schedule, sent: [] }), 14);
});

test("a step already sent does not fire again", () => {
  assert.equal(
    dueStep({ dueDate: d("2026-03-01"), now: d("2026-03-21"), schedule, sent: [14] }),
    null,
  );
});

test("the quiet period suppresses a send that is otherwise due", () => {
  const base = { dueDate: d("2026-03-01"), now: d("2026-03-08"), schedule, sent: [3] };
  assert.equal(dueStep({ ...base, lastSentAt: d("2026-03-08") }), null, "same day");
  assert.equal(dueStep({ ...base, lastSentAt: d("2026-03-07") }), 7, "yesterday is fine");
});

test("an empty schedule never fires", () => {
  assert.equal(dueStep({ dueDate: d("2026-03-01"), now: d("2026-04-01"), schedule: [], sent: [] }), null);
});

test("tone never gets firm about an invoice that is not yet due", () => {
  assert.equal(toneForStep(-3, "final"), "friendly");
  assert.equal(toneForStep(0, "firm"), "firm");
  // A friendly org still escalates once something is a fortnight late.
  assert.equal(toneForStep(14, "friendly"), "firm");
  assert.equal(toneForStep(3, "friendly"), "friendly");
});

const copyInput = {
  tone: "friendly" as const,
  step: 7,
  businessName: "Acme Works",
  clientName: "Zippy Dry Cleaners",
  invoiceNumber: "INV-0042",
  amountText: "KES 20,000.00",
  dueDateText: "10 Mar 2026",
  payUrl: "https://tallypay.smp.co.ke/d/tok",
};

test("every message carries the amount, the number and a way to pay", () => {
  for (const step of [-3, 0, 3, 7, 14, 30]) {
    for (const tone of ["friendly", "firm", "final"] as const) {
      const { subject, body } = reminderCopy({ ...copyInput, step, tone });
      assert.ok(subject.includes("INV-0042"), `subject missing number (step ${step}, ${tone})`);
      assert.ok(body.includes("KES 20,000.00"), `body missing amount (step ${step}, ${tone})`);
      assert.ok(body.includes(copyInput.payUrl), `body missing pay link (step ${step}, ${tone})`);
      assert.ok(body.includes("Zippy Dry Cleaners"), `body missing client (step ${step}, ${tone})`);
    }
  }
});

test("a not-yet-due nudge never calls the invoice overdue", () => {
  const { subject, body } = reminderCopy({ ...copyInput, step: -3, tone: "final" });
  assert.ok(!/overdue/i.test(subject + body));
});

test("an overdue message states how late it is", () => {
  const { subject } = reminderCopy({ ...copyInput, step: 7, tone: "firm" });
  assert.ok(subject.includes("7 days overdue"));
});

test("the WhatsApp variant stays one message long and carries the link", () => {
  const msg = whatsappCopy({ ...copyInput, step: 7 });
  assert.ok(msg.includes(copyInput.payUrl));
  assert.ok(msg.includes("INV-0042"));
  assert.ok(!msg.includes("\n"), "WhatsApp copy should be a single line");
});

const candidate = {
  dueDate: d("2026-03-01"),
  status: "sent",
  balanceDue: 50_000,
  remindersPaused: false,
  clientOptedOut: false,
};

test("isChaseable refuses the cases that would embarrass us", () => {
  assert.equal(isChaseable(candidate), true);
  assert.equal(isChaseable({ ...candidate, balanceDue: 0 }), false, "already paid");
  assert.equal(isChaseable({ ...candidate, status: "paid" }), false);
  assert.equal(isChaseable({ ...candidate, status: "draft" }), false, "never sent");
  assert.equal(isChaseable({ ...candidate, status: "void" }), false);
  assert.equal(isChaseable({ ...candidate, dueDate: null }), false, "no due date to count from");
  assert.equal(isChaseable({ ...candidate, remindersPaused: true }), false);
  assert.equal(isChaseable({ ...candidate, clientOptedOut: true }), false);
  assert.equal(isChaseable(candidate, 100_000), false, "below the minimum worth chasing");
  assert.equal(isChaseable({ ...candidate, status: "partial" }), true, "part-paid still owes");
});

test("ancient debts are not chased automatically", () => {
  assert.equal(isTooOldToAutoChase(89, 90), false);
  assert.equal(isTooOldToAutoChase(90, 90), false, "the cap itself is still chaseable");
  assert.equal(isTooOldToAutoChase(91, 90), true);
  assert.equal(isTooOldToAutoChase(400, 90), true);
  // Not-yet-due and recently-due invoices are never "too old".
  assert.equal(isTooOldToAutoChase(-5, 90), false);
  assert.equal(isTooOldToAutoChase(0, 90), false);
  // 0 disables the cap for vendors who really do want to chase forever.
  assert.equal(isTooOldToAutoChase(5000, 0), false);
});

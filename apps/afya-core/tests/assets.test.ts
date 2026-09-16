/**
 * M63 Assets & Maintenance.
 *
 * The rules worth a test are the ones that stop work: an overdue blocking check
 * closes the theatre, a failed check does not reset its own clock, and a fridge
 * that spent the night at fourteen degrees makes its stock unpickable without
 * anybody having to join the two facts up by hand.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AFYA_DB = join(mkdtempSync(join(tmpdir(), "afya-assets-")), "t.db");
process.env.AFYA_SCHEMA = join(process.cwd(), "src", "lib", "schema.sql");

import test from "node:test";
import assert from "node:assert/strict";

const A = await import("../src/lib/assets.ts");
const I = await import("../src/lib/inventory.ts");
const N = await import("../src/lib/notifications.ts");
const L = await import("../src/lib/accounting.ts");
const { seedDemo } = await import("../src/lib/seed.ts");
const { registerDevice } = await import("../src/lib/facility.ts");
const { verifyAuditChain, today } = await import("../src/lib/db.ts");

const { facilityId, adminId } = seedDemo();
registerDevice({ facilityId, code: "ASD1", label: "Estates", byUserId: adminId, byUserName: "admin" });

const DEV = "ASD1";
const BY = { byUserId: adminId!, byUserName: "Facility Administrator" };
const MAKE = { ...BY, deviceCode: DEV };

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ago = (n: number) => addDays(today(), -n);
const ahead = (n: number) => addDays(today(), n);

let tag = 0;
function asset(name: string, extra: Partial<Parameters<typeof A.addAsset>[0]> = {}) {
  return A.addAsset({ facilityId, tag: `T-${++tag}`, name, critical: true, ...MAKE, ...extra });
}

// ------------------------------------------------------------------ register

test("an asset needs a tag, because that is what is painted on the side", () => {
  assert.throws(() => asset("Nameless", { tag: "  " }), /tag/);
});

test("a cold chain asset must say which store it holds", () => {
  // Without it an excursion has no stock to reach, and the whole point is lost.
  assert.throws(
    () => asset("Orphan fridge", { category: "cold_chain" }),
    /which store/,
  );
});

test("changing an asset's status must record why", () => {
  const id = asset("Suction unit");
  assert.throws(() => A.setAssetStatus({ assetId: id, status: "out_of_service", reason: "", ...BY }), /why/);
});

// --------------------------------------------------------------- usability

test("an overdue blocking check stops the asset being used", () => {
  const id = asset("Autoclave");
  A.scheduleMaintenance({
    assetId: id, kind: "safety_test", name: "Pressure vessel test", everyDays: 365,
    regulator: "DOSHS", blocksUse: true, lastDoneOn: ago(400), deviceCode: DEV,
  });

  const check = A.usable(id);
  assert.equal(check.usable, false);
  assert.match(check.reasons[0], /Pressure vessel test overdue by 35 days \(DOSHS\)/);
});

test("an overdue non-blocking check warns and nothing more", () => {
  // A chair with a late inspection is not a chair nobody may sit in.
  const id = asset("Waiting room chairs", { category: "furniture", critical: false });
  A.scheduleMaintenance({
    assetId: id, kind: "inspection", name: "Annual inspection", everyDays: 365,
    lastDoneOn: ago(400), deviceCode: DEV,
  });

  const check = A.usable(id);
  assert.equal(check.usable, true);
  assert.equal(check.reasons.length, 0);
  assert.match(check.warnings[0], /Annual inspection overdue/);
});

test("a check due today is not overdue", () => {
  const id = asset("Nebuliser");
  A.scheduleMaintenance({
    assetId: id, kind: "service", name: "Service", everyDays: 90,
    nextDueOn: today(), blocksUse: true, deviceCode: DEV,
  });
  assert.equal(A.usable(id).usable, true);
});

// ------------------------------------------------------------ maintenance

test("a passed check moves the clock forward by the interval", () => {
  const id = asset("Steriliser");
  const schedule = A.scheduleMaintenance({
    assetId: id, kind: "service", name: "Service", everyDays: 90,
    lastDoneOn: ago(100), deviceCode: DEV,
  });

  A.recordMaintenance({
    assetId: id, scheduleId: schedule, kind: "service", doneOn: today(),
    passed: true, performedBy: "Kentronics", ...MAKE,
  });

  const [row] = A.schedulesFor(id);
  assert.equal(row.last_done_on, today());
  assert.equal(row.next_due_on, ahead(90));
  assert.equal(A.usable(id).usable, true);
});

test("a failed check does not move the clock and takes a blocking asset out of service", () => {
  // The most important row in the table is the one that says it failed. A
  // system that records only successful maintenance hides exactly the thing
  // somebody needs to find.
  const id = asset("Theatre autoclave");
  const schedule = A.scheduleMaintenance({
    assetId: id, kind: "safety_test", name: "Pressure vessel test", everyDays: 365,
    regulator: "DOSHS", blocksUse: true, lastDoneOn: ago(370), deviceCode: DEV,
  });

  A.recordMaintenance({
    assetId: id, scheduleId: schedule, kind: "safety_test", doneOn: today(),
    passed: false, findings: "Door seal fails at 1.8 bar", performedBy: "DOSHS inspector", ...MAKE,
  });

  const [row] = A.schedulesFor(id);
  assert.equal(row.last_done_on, ago(370), "a failed check is not a done check");
  assert.equal(row.next_due_on, addDays(ago(370), 365));

  const after = A.getAsset(id)!;
  assert.equal(after.status, "out_of_service");
  assert.match(after.status_reason, /Door seal fails at 1\.8 bar/);
  assert.equal(A.usable(id).usable, false);

  const alerts = N.inbox(facilityId).filter(
    (n) => n.kind === "asset_failed_check" && n.entity_id === id,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, "critical");
});

test("a failed check must record what was found", () => {
  const id = asset("Trolley");
  assert.throws(
    () => A.recordMaintenance({ assetId: id, kind: "inspection", passed: false, ...MAKE }),
    /what was found/,
  );
});

test("a schedule interval is a whole number of days above zero", () => {
  const id = asset("Fan");
  assert.throws(
    () => A.scheduleMaintenance({ assetId: id, kind: "service", name: "S", everyDays: 0, deviceCode: DEV }),
    /above zero/,
  );
});

// ------------------------------------------------------------ work orders

test("a fault takes a critical asset down and says so out loud", () => {
  const id = asset("Standby generator", { location: "Yard" });
  const order = A.reportFault({ assetId: id, fault: "Will not crank", ...MAKE });

  assert.equal(A.getAsset(id)!.status, "under_repair");
  assert.equal(A.usable(id).usable, false);

  const alerts = N.inbox(facilityId).filter(
    (n) => n.kind === "asset_down" && n.entity_id === id,
  );
  assert.equal(alerts.length, 1);

  A.closeWorkOrder({ workOrderId: order, status: "fixed", resolution: "New starter motor", costCents: 18_000_00, ...BY });
  assert.equal(A.getAsset(id)!.status, "in_service");
  assert.equal(A.usable(id).usable, true);
});

test("a fault that leaves the asset usable is a warning, not a stop", () => {
  const id = asset("Ultrasound");
  A.reportFault({ assetId: id, fault: "Probe cable frayed", outOfService: false, ...MAKE });

  const check = A.usable(id);
  assert.equal(check.usable, true);
  assert.match(check.warnings[0], /still usable: Probe cable frayed/);
});

test("fixing one fault does not put the asset back while another still holds it out", () => {
  const id = asset("Dental chair");
  const first = A.reportFault({ assetId: id, fault: "Compressor dead", ...MAKE });
  A.reportFault({ assetId: id, fault: "Light not working", ...MAKE });

  A.closeWorkOrder({ workOrderId: first, status: "fixed", resolution: "Compressor replaced", ...BY });
  assert.equal(A.getAsset(id)!.status, "under_repair");
});

test("beyond repair leaves the asset out of service, not quietly back in it", () => {
  const id = asset("Old centrifuge");
  const order = A.reportFault({ assetId: id, fault: "Rotor cracked", ...MAKE });
  A.closeWorkOrder({ workOrderId: order, status: "beyond_repair", resolution: "Rotor unavailable", ...BY });

  const after = A.getAsset(id)!;
  assert.equal(after.status, "out_of_service");
  assert.match(after.status_reason, /Beyond repair/);
});

test("downtime is counted from when it was reported, not from when somebody opened a job card", () => {
  const id = asset("Oxygen concentrator");
  const reportedAt = new Date(Date.now() - 5 * 3_600_000).toISOString();
  A.reportFault({ assetId: id, fault: "Alarm sounding", reportedAt, ...MAKE });

  const fault = A.openFaults(facilityId).find((f) => f.assetId === id)!;
  assert.equal(fault.downHours, 5);
  assert.equal(fault.critical, true);
});

test("closing a work order must say what was done", () => {
  const id = asset("Wheelchair", { critical: false });
  const order = A.reportFault({ assetId: id, fault: "Brake slipping", ...MAKE });
  assert.throws(() => A.closeWorkOrder({ workOrderId: order, status: "fixed", resolution: "", ...BY }), /what was done/);
});

test("a repair billed on equipment still under warranty is money the facility should not have paid", () => {
  const id = asset("New analyser", { warrantyUntil: ahead(200) });
  const order = A.reportFault({ assetId: id, fault: "Pump leaking", ...MAKE });
  assert.equal(A.getWorkOrder(order)!.under_warranty, 1);

  A.closeWorkOrder({ workOrderId: order, status: "fixed", resolution: "Pump replaced", costCents: 40_000_00, ...BY });
  assert.ok(A.assetSummary(facilityId).paidUnderWarranty >= 1);
});

// -------------------------------------------------------------- cold chain

test("an excursion quarantines everything in that fridge's store", async () => {
  const store = "CCTEST";
  I.defineStore({ facilityId, code: store, name: "Cold chain test store", kind: "main" });
  I.receiveStock({
    storeCode: store, productCode: "PARA-500", batchNumber: "CC-1",
    expiresOn: ahead(300), quantity: 100, ...MAKE,
  });

  const fridge = asset("Vaccine fridge", { category: "cold_chain", storeCode: store });
  assert.equal(I.pickable(store, "PARA-500").length, 1);

  const cold = A.recordTemperature({ assetId: fridge, readingTenths: 140, ...BY });
  assert.equal(cold.inRange, false);
  assert.equal(cold.quarantined, 1);

  // The point of doing it at the moment of the reading: the stock is
  // unpickable before anybody thinks to connect the two facts.
  assert.equal(I.pickable(store, "PARA-500").length, 0);
  assert.equal(I.stockPosition(store).find((l) => l.productCode === "PARA-500")!.quarantined, 100);

  const alerts = N.inbox(facilityId).filter((n) => n.kind === "cold_chain_excursion");
  assert.ok(alerts.some((n) => n.entity_id === fridge));
});

test("a reading inside the range quarantines nothing", () => {
  const store = "CCOK";
  I.defineStore({ facilityId, code: store, name: "Cold chain ok", kind: "main" });
  I.receiveStock({
    storeCode: store, productCode: "PARA-500", batchNumber: "CC-2",
    expiresOn: ahead(300), quantity: 50, ...MAKE,
  });
  const fridge = asset("Second fridge", { category: "cold_chain", storeCode: store });

  const reading = A.recordTemperature({ assetId: fridge, readingTenths: 45, ...BY });
  assert.deepEqual(reading, { inRange: true, quarantined: 0 });
  assert.equal(I.pickable(store, "PARA-500").length, 1);
});

test("the boundaries of the range are inside it", () => {
  const fridge = asset("Boundary fridge", { category: "cold_chain", storeCode: "MAIN" });
  assert.equal(A.recordTemperature({ assetId: fridge, readingTenths: 20, ...BY }).inRange, true);
  assert.equal(A.recordTemperature({ assetId: fridge, readingTenths: 80, ...BY }).inRange, true);
  assert.equal(A.recordTemperature({ assetId: fridge, readingTenths: 19, ...BY }).inRange, false);
});

test("a reading no fridge could show is a transposed digit, not a reading", () => {
  const fridge = asset("Typo fridge", { category: "cold_chain", storeCode: "MAIN" });
  assert.throws(() => A.recordTemperature({ assetId: fridge, readingTenths: 4500, ...BY }), /transposed/);
});

test("only a cold chain asset has a temperature", () => {
  const id = asset("Desk", { category: "furniture", critical: false });
  assert.throws(() => A.recordTemperature({ assetId: id, readingTenths: 40, ...BY }), /not a cold chain/);
});

test("a fridge nobody has read since yesterday is a fridge nobody is watching", () => {
  const fridge = asset("Unread fridge", { category: "cold_chain", storeCode: "MAIN" });
  const board = A.coldChainBoard(facilityId).find((c) => c.asset.id === fridge)!;
  assert.equal(board.lastReadingTenths, null);
  assert.equal(board.overdueReading, true);
});

// ------------------------------------------------------------ depreciation

test("depreciation is straight line, posts to the ledger and cannot double-post", () => {
  const id = asset("Ambulance", {
    category: "vehicle", acquiredOn: "2024-01-15", costCents: 4_800_000_00, usefulLifeMonths: 96,
  });

  const first = A.postDepreciation({ facilityId, period: "2026-08", ...BY });
  assert.ok(first.journalId);
  assert.ok(first.amountCents > 0);

  const second = A.postDepreciation({ facilityId, period: "2026-08", ...BY });
  assert.equal(second.journalId, first.journalId, "a second run must find the journal already there");

  // 4,800,000.00 over 96 months is 50,000.00 a month for this one asset.
  const perMonth = Math.round(4_800_000_00 / 96);
  assert.ok(first.amountCents >= perMonth);
  // January 2024 to September 2026 is thirty-two whole months of wearing out.
  assert.equal(A.bookValue(A.getAsset(id)!, "2026-09-16"), 4_800_000_00 - perMonth * 32);
});

test("nothing depreciates before it arrives or past the end of its life", () => {
  const future = asset("Not yet delivered", {
    acquiredOn: ahead(60), costCents: 100_000_00, usefulLifeMonths: 60,
  });
  const finished = asset("Long since written off", {
    acquiredOn: "2010-01-01", costCents: 100_000_00, usefulLifeMonths: 60,
  });

  assert.equal(A.bookValue(A.getAsset(future)!), 100_000_00);
  assert.equal(A.bookValue(A.getAsset(finished)!), 0);
});

test("a depreciation period is a month", () => {
  assert.throws(() => A.postDepreciation({ facilityId, period: "2026", ...BY }), /YYYY-MM/);
});

test("the depreciation journal balances", () => {
  const journals = L.journalsIn(facilityId).filter((j) => j.source_kind === "depreciation");
  assert.ok(journals.length >= 1);
  for (const journal of journals) {
    const lines = L.journalLines(journal.id);
    const debits = lines.reduce((s, l) => s + l.debit_cents, 0);
    const credits = lines.reduce((s, l) => s + l.credit_cents, 0);
    assert.equal(debits, credits);
  }
});

// ---------------------------------------------------------------- reports

test("the due board puts overdue blocking checks first", () => {
  const board = A.maintenanceDue(facilityId, 365);
  const blocking = board.findIndex((r) => r.blocksUse && r.overdue);
  const other = board.findIndex((r) => !(r.blocksUse && r.overdue));
  if (blocking !== -1 && other !== -1) assert.ok(blocking < other);
});

test("the summary counts what somebody has to act on", () => {
  const summary = A.assetSummary(facilityId);
  assert.ok(summary.assets > 0);
  assert.ok(summary.blockingOverdue >= 1);
  assert.ok(summary.coldChainAssets >= 3);
  assert.ok(summary.coldChainOutOfRange >= 1);
  assert.ok(summary.quarantinedBatches >= 1);
  assert.ok(summary.bookValueCents < summary.costCents, "something must have worn out by now");
});

test("the audit chain still verifies after all of that", () => {
  assert.equal(verifyAuditChain().ok, true);
});

// ------------------------------------------------ what depends on what

test("a dependency turns usable() from an answer into a control", () => {
  const fridge = asset("Blood bank fridge", { category: "cold_chain", storeCode: "MAIN" });
  A.dependsOn({ kind: "store", ref: "BLOOD", assetId: fridge, why: "the only one" });

  assert.equal(A.equipmentBlock("store", "BLOOD"), null);

  A.reportFault({ assetId: fridge, fault: "Compressor stopped", ...MAKE });
  const blocked = A.equipmentBlock("store", "BLOOD");
  assert.match(blocked!, /the only one/);
  assert.match(blocked!, /Compressor stopped/);
});

test("a warning does not block, because a line everybody ignores is worse than none", () => {
  const chairs = asset("Waiting chairs", { category: "furniture", critical: false });
  A.scheduleMaintenance({
    assetId: chairs, kind: "inspection", name: "Annual inspection", everyDays: 365,
    lastDoneOn: ago(400), deviceCode: DEV,
  });
  A.dependsOn({ kind: "store", ref: "WAITING", assetId: chairs });

  assert.equal(A.usable(chairs).warnings.length, 1);
  assert.equal(A.equipmentBlock("store", "WAITING"), null);
});

test("a dependency on an asset that does not exist is refused", () => {
  assert.throws(() => A.dependsOn({ kind: "theatre", ref: "OT9", assetId: "nothing" }), /no such asset/);
});

test("naming the same dependency twice updates it rather than duplicating it", () => {
  const generator = asset("Backup generator");
  A.dependsOn({ kind: "theatre", ref: "OT9", assetId: generator, why: "power" });
  A.dependsOn({ kind: "theatre", ref: "OT9", assetId: generator, why: "power and lighting" });

  const deps = A.dependenciesFor("theatre", "OT9");
  assert.equal(deps.length, 1);
  assert.equal(deps[0].why, "power and lighting");
});

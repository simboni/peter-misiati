import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/test-db";
import { FARM_ID, fakeSession, seedAnimal, seedCustomer, seedFarm, seedProduct, seedUser } from "@/test/factory";
import * as s from "@/db/schema";
import { newId } from "@/lib/ids";
import { addDays, today } from "@/lib/domain/dates";
import { dayProduction, recordMilkBatch, milkSheet } from "./milk";
import { recordTreatmentFor, type DbLike } from "./health";
import { allocateMilk, recordDisposal } from "./sales";
import { recordSale, meatWithdrawalOn } from "./trading";

vi.mock("next/cache", () => ({ updateTag: () => {}, revalidateTag: () => {} }));

const NOW = today();

async function setup() {
  const { db, close } = await createTestDb();
  await seedFarm(db);
  const userId = await seedUser(db, { fullName: "Kamau", role: "MANAGER" });
  return { db, close, session: fakeSession({ userId, role: "MANAGER" }) };
}

async function seedCow(db: TestDb, name: string, calvedOn: string) {
  const id = await seedAnimal(db, { name, tag: `KE-${name}`, dateOfBirth: "2020-01-01" });
  await db.insert(s.calving).values({ id: newId(), farmId: FARM_ID, damId: id, calvedOn, recordedBy: newId() });
  return id;
}

describe("probe", () => {
  it("unknown-period milk reaching the co-op", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, "Muthoni", addDays(NOW, -120));
    const p = await seedProduct(db, { name: "Unlabelled", milkWithdrawalDays: null, meatWithdrawalDays: null, labelSource: null });
    await recordTreatmentFor(session, { animalId: cow, productId: p }, db as unknown as DbLike);
    await recordMilkBatch(session, { date: NOW, session: "MORNING", rows: [{ animalId: cow, litres: 16 }] }, db);

    const coopId = await seedCustomer(db, { customerType: "COOP" });
    const sold = await recordDisposal(session, { date: NOW, channel: "COOP", customerId: coopId, litres: 16 }, db);
    console.log("SOLD", JSON.stringify(sold, null, 1));

    const alloc = await allocateMilk(session, NOW, db);
    console.log("ALLOC", JSON.stringify({ production: alloc.production, warnings: alloc.warnings, reconciliation: alloc.reconciliation }, null, 1));
    expect(true).toBe(true);
    await close();
  });

  it("zero-day vs unknown", async () => {
    const { db, close, session } = await setup();
    const zero = await seedCow(db, "Zero", addDays(NOW, -120));
    const zp = await seedProduct(db, { name: "Multivit", productType: "MINERAL", milkWithdrawalDays: 0, meatWithdrawalDays: 0 });
    await recordTreatmentFor(session, { animalId: zero, productId: zp }, db as unknown as DbLike);
    const row = (await milkSheet(session, NOW, "MORNING", db)).rows.find((r) => r.animalId === zero)!;
    console.log("ZERO ROW", JSON.stringify({ locked: row.locked, lockReason: row.lockReason, lockMessage: row.lockMessage, saleable: row.saleable }));
    const day = await dayProduction(session, NOW, db);
    console.log("ZERO DAY", JSON.stringify(day.withheldAnimals));
    // meat side
    console.log("ZERO MEAT", JSON.stringify(await meatWithdrawalOn(db, FARM_ID, zero, NOW)));
    await close();
  });

  it("meat warning on a farmer-to-farmer sale", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, "Wanjiku", addDays(NOW, -120));
    const p = await seedProduct(db, { name: "Penstrep", milkWithdrawalDays: 7, meatWithdrawalDays: 28 });
    await recordTreatmentFor(session, { animalId: cow, productId: p }, db as unknown as DbLike);
    const sale = await recordSale(session, { animalId: cow, exitDate: addDays(NOW, 3), reason: "SOLD", priceKes: 90000, counterpartyKind: "FARMER" }, db);
    console.log("FARMER SALE", JSON.stringify(sale, null, 1));
    await close();
  });

  it("meat withdrawal with unknown meat period, sold to butchery", async () => {
    const { db, close, session } = await setup();
    const cow = await seedCow(db, "Nyokabi", addDays(NOW, -120));
    const p = await seedProduct(db, { name: "Unlabelled", milkWithdrawalDays: null, meatWithdrawalDays: null, labelSource: null });
    await recordTreatmentFor(session, { animalId: cow, productId: p }, db as unknown as DbLike);
    const sale = await recordSale(session, { animalId: cow, exitDate: addDays(NOW, 3), reason: "SOLD", priceKes: 90000, counterpartyKind: "BUTCHERY" }, db);
    console.log("BUTCHERY UNKNOWN", JSON.stringify(sale, null, 1));
    const old = await meatWithdrawalOn(db, FARM_ID, cow, addDays(NOW, 400));
    console.log("MEAT AT +400", JSON.stringify(old));
    await close();
  });
});

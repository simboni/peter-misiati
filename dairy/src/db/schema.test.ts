import { describe, it, expect, afterAll } from "vitest";
import { createTestDb } from "./test-db";
import { seedFarm, seedAnimal, FARM_ID } from "@/test/factory";
import * as s from "./schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";

/**
 * Smoke test for the foundation. If this fails, nothing built on top of it can
 * be trusted, so it runs first and covers the two properties every module
 * depends on: the schema actually applies, and offline idempotency works.
 */
describe("foundation", () => {
  it("applies the whole schema to a fresh database", async () => {
    const { db, close } = await createTestDb();
    await seedFarm(db);
    const rows = await db.select().from(s.farm).where(eq(s.farm.id, FARM_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Kiambu Test Dairy");
    await close();
  });

  it("makes a replayed offline write a no-op, not a duplicate", async () => {
    const { db, close } = await createTestDb();
    await seedFarm(db);
    const animalId = await seedAnimal(db);
    const userId = newId();

    // The client generates the row id, so the same entry flushed twice over a
    // flaky link must land once. This is the whole basis of the outbox design.
    const row = {
      id: newId(),
      farmId: FARM_ID,
      animalId,
      recordedOn: "2026-08-03",
      session: "MORNING" as const,
      litres: "12.50",
      recordedBy: userId,
      recordedAt: new Date(),
    };

    await db.insert(s.milkRecord).values(row).onConflictDoNothing();
    await db.insert(s.milkRecord).values(row).onConflictDoNothing();

    const saved = await db.select().from(s.milkRecord).where(eq(s.milkRecord.animalId, animalId));
    expect(saved).toHaveLength(1);
    expect(saved[0].litres).toBe("12.50");
    await close();
  });

  it("keeps money as an exact decimal string, never a float", async () => {
    const { db, close } = await createTestDb();
    await seedFarm(db);
    const id = newId();
    await db.insert(s.expense).values({
      id,
      farmId: FARM_ID,
      incurredOn: "2026-08-03",
      category: "FEEDS",
      amountKes: "3450.55",
      recordedBy: newId(),
    });
    const [row] = await db.select().from(s.expense).where(eq(s.expense.id, id));
    expect(row.amountKes).toBe("3450.55");
    await close();
  });
});

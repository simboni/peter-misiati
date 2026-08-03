/**
 * Test data factories.
 *
 * Deliberately built around a realistic Kenyan smallholder-commercial herd:
 * grade Friesians and Ayrshires yielding 8–18 L/day, a co-operative that pays
 * monthly, a school on 30-day terms and neighbours on a running tab. Tests that
 * run against plausible data catch bugs that tests against `foo`/`bar` do not.
 */
import { newId } from "@/lib/ids";
import type { TestDb } from "@/db/test-db";
import * as s from "@/db/schema";
import { hashPin } from "@/lib/session";

export const FARM_ID = "11111111-1111-4111-8111-111111111111";

export async function seedFarm(db: TestDb) {
  await db.insert(s.farm).values({
    id: FARM_ID,
    name: "Kiambu Test Dairy",
    county: "Kiambu",
    systemType: "ZERO_GRAZING",
    milkingSessions: 2,
    currency: "KES",
    areaClass: "RURAL",
    memberNo: "M-4471",
  });
  return FARM_ID;
}

export async function seedUser(
  db: TestDb,
  overrides: Partial<typeof s.appUser.$inferInsert> = {},
) {
  const id = overrides.id ?? newId();
  await db.insert(s.appUser).values({
    id,
    farmId: FARM_ID,
    fullName: "Kamau Mwangi",
    role: "HERDSMAN",
    pinHash: await hashPin("1234"),
    language: "en",
    active: true,
    ...overrides,
  });
  return id;
}

export async function seedAnimal(
  db: TestDb,
  overrides: Partial<typeof s.animal.$inferInsert> = {},
) {
  const id = overrides.id ?? newId();
  await db.insert(s.animal).values({
    id,
    farmId: FARM_ID,
    tag: overrides.tag ?? `KE-${Math.floor(Math.random() * 100000)}`,
    name: "Njeri",
    sex: "F",
    primaryBreed: "FRIESIAN",
    breedComposition: "3/4 Friesian x 1/4 Zebu",
    dateOfBirth: "2021-03-14",
    origin: "BORN",
    enteredHerdOn: "2021-03-14",
    ...overrides,
  });
  return id;
}

export async function seedProduct(
  db: TestDb,
  overrides: Partial<typeof s.product.$inferInsert> = {},
) {
  const id = overrides.id ?? newId();
  await db.insert(s.product).values({
    id,
    farmId: FARM_ID,
    name: "Oxytetracycline LA 20%",
    activeIngredient: "Oxytetracycline",
    productType: "ANTIBIOTIC",
    milkWithdrawalDays: 7,
    meatWithdrawalDays: 28,
    labelSource: "PCPB label",
    ...overrides,
  });
  return id;
}

export async function seedCustomer(
  db: TestDb,
  overrides: Partial<typeof s.customer.$inferInsert> = {},
) {
  const id = overrides.id ?? newId();
  await db.insert(s.customer).values({
    id,
    farmId: FARM_ID,
    name: "Limuru Dairy Co-operative",
    customerType: "COOP",
    areaClass: "RURAL",
    fulfilment: "DELIVERED",
    paymentTerms: "MONTHLY",
    ...overrides,
  });
  return id;
}

export async function seedFeedItem(
  db: TestDb,
  overrides: Partial<typeof s.feedItem.$inferInsert> = {},
) {
  const id = overrides.id ?? newId();
  await db.insert(s.feedItem).values({
    id,
    farmId: FARM_ID,
    name: "Dairy meal (Unga)",
    category: "CONCENTRATE",
    dmPct: "88.00",
    cpPct: "16.00",
    defaultUnit: "BAG_70KG",
    defaultUnitWeightKg: "70",
    ...overrides,
  });
  return id;
}

export async function seedEmployee(
  db: TestDb,
  overrides: Partial<typeof s.employee.$inferInsert> = {},
) {
  const id = overrides.id ?? newId();
  await db.insert(s.employee).values({
    id,
    farmId: FARM_ID,
    fullName: "Kamau Mwangi",
    role: "HERDSMAN",
    employmentType: "PERMANENT",
    startedOn: "2024-01-15",
    basicWageKes: "12000.00",
    wagePeriod: "MONTHLY",
    housingProvided: true,
    ...overrides,
  });
  return id;
}

/** A session object for calling action helpers directly in tests. */
export function fakeSession(overrides: Partial<{
  userId: string; farmId: string; role: s.Role; fullName: string; language: "en" | "sw";
}> = {}) {
  return {
    userId: overrides.userId ?? newId(),
    farmId: overrides.farmId ?? FARM_ID,
    role: overrides.role ?? ("MANAGER" as s.Role),
    fullName: overrides.fullName ?? "Grace Wanjiru",
    language: overrides.language ?? ("en" as const),
    expiresAt: Date.now() + 3_600_000,
  };
}

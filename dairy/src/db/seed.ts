/**
 * Demo farm.
 *
 * Modelled on a real Kiambu zero-grazing unit rather than invented data: grade
 * Friesians and Ayrshires at 8–18 L/day, a co-operative paying monthly on
 * check-off, a school on 30-day terms, neighbours on a running tab, dairy meal
 * in 70 kg bags and Boma Rhodes in bales of a weight we actually record.
 *
 * Seeding with plausible numbers matters: a demo built on `foo`/`bar` hides
 * exactly the bugs a farm would hit on day one.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import * as s from "./schema";

function hashPinSync(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(pin, salt, 64, { N: 16384 });
  return `scrypt$16384$${salt}$${derived.toString("hex")}`;
}

const id = () => randomUUID();
const FARM = id();

async function main() {
  const path = process.env.DATABASE_PATH ?? "./.pgdata";
  const pg = new PGlite(path);
  await pg.exec(readFileSync(join(process.cwd(), "src/db/ddl.sql"), "utf8"));
  const db = drizzle(pg, { schema: s });

  await db.insert(s.farm).values({
    id: FARM,
    name: "Wanjiru Farm, Kiambu",
    county: "Kiambu",
    systemType: "ZERO_GRAZING",
    milkingSessions: 2,
    areaClass: "RURAL",
    memberNo: "LDC-4471",
  });

  /* ---- People. Every PIN is 1234 in the demo. ---- */
  const owner = id();
  const manager = id();
  const herdsman = id();
  const rider = id();
  await db.insert(s.appUser).values([
    { id: owner, farmId: FARM, fullName: "Grace Wanjiru", role: "OWNER", pinHash: hashPinSync("1234") },
    { id: manager, farmId: FARM, fullName: "Peter Kariuki", role: "MANAGER", pinHash: hashPinSync("1234") },
    { id: herdsman, farmId: FARM, fullName: "Kamau Mwangi", role: "HERDSMAN", pinHash: hashPinSync("1234"), language: "sw" },
    { id: rider, farmId: FARM, fullName: "Otieno Odhiambo", role: "RIDER", pinHash: hashPinSync("1234") },
  ]);

  await db.insert(s.employee).values([
    { id: id(), farmId: FARM, appUserId: manager, fullName: "Peter Kariuki", role: "FARM_FOREMAN", employmentType: "PERMANENT", startedOn: "2023-06-01", basicWageKes: "32000.00", wagePeriod: "MONTHLY", housingProvided: true },
    // The case payroll must get exactly right: below the personal relief, so
    // zero PAYE — but NSSF, SHIF and the Housing Levy all still apply.
    { id: id(), farmId: FARM, appUserId: herdsman, fullName: "Kamau Mwangi", role: "HERDSMAN", employmentType: "PERMANENT", startedOn: "2024-01-15", basicWageKes: "12000.00", wagePeriod: "MONTHLY", housingProvided: true },
    { id: id(), farmId: FARM, appUserId: rider, fullName: "Otieno Odhiambo", role: "HERDSMAN", employmentType: "PERMANENT", startedOn: "2024-09-01", basicWageKes: "14000.00", wagePeriod: "MONTHLY", housingProvided: true },
    { id: id(), farmId: FARM, fullName: "Jane Nyambura", role: "UNSKILLED", employmentType: "CASUAL", startedOn: "2026-07-20", basicWageKes: "500.00", wagePeriod: "DAILY", housingProvided: false },
  ]);

  /* ---- The herd ---- */
  const cows = [
    { name: "Njeri", tag: "KE-0101", breed: "FRIESIAN", dob: "2020-04-12", calved: "2026-02-10", parity: 3 },
    { name: "Wanjiku", tag: "KE-0102", breed: "FRIESIAN", dob: "2019-11-03", calved: "2026-01-22", parity: 4 },
    { name: "Muthoni", tag: "KE-0103", breed: "AYRSHIRE", dob: "2021-06-18", calved: "2026-04-02", parity: 2 },
    { name: "Nyambura", tag: "KE-0104", breed: "AYRSHIRE", dob: "2021-01-09", calved: "2026-03-15", parity: 2 },
    { name: "Chepkoech", tag: "KE-0105", breed: "FRIESIAN", dob: "2022-02-27", calved: "2026-05-20", parity: 1 },
    { name: "Akinyi", tag: "KE-0106", breed: "JERSEY", dob: "2022-08-14", calved: "2026-08-01", parity: 1 },
  ];
  const cowIds: Record<string, string> = {};
  for (const c of cows) {
    const aid = id();
    cowIds[c.name] = aid;
    await db.insert(s.animal).values({
      id: aid, farmId: FARM, tag: c.tag, name: c.name, sex: "F",
      primaryBreed: c.breed, breedComposition: `Grade ${c.breed[0] + c.breed.slice(1).toLowerCase()}`,
      dateOfBirth: c.dob, origin: "BORN", enteredHerdOn: c.dob,
    });
    await db.insert(s.calving).values({
      id: id(), farmId: FARM, damId: aid, calvedOn: c.calved,
      calvingEase: 1, numberBorn: 1, recordedBy: manager,
    });
  }

  // Young stock across the ladder, so the derived-class logic has something to chew on.
  const young = [
    { name: "Wairimu", tag: "KE-0201", dob: "2025-02-10", sex: "F" as const },  // bulling heifer
    { name: "Kanini", tag: "KE-0202", dob: "2025-11-05", sex: "F" as const },   // heifer
    { name: "Mumbi", tag: "KE-0203", dob: "2026-06-20", sex: "F" as const },    // weaner
    { name: "Kimani", tag: "KE-0204", dob: "2026-07-25", sex: "M" as const },   // bull calf
  ];
  for (const y of young) {
    await db.insert(s.animal).values({
      id: id(), farmId: FARM, tag: y.tag, name: y.name, sex: y.sex,
      primaryBreed: "FRIESIAN", dateOfBirth: y.dob, origin: "BORN", enteredHerdOn: y.dob,
    });
  }

  /* ---- Customers: all three channels ---- */
  const coop = id();
  const school = id();
  const households = [
    { name: "Mama Njeri", litres: "2.0" },
    { name: "Mwalimu Otieno", litres: "1.0" },
    { name: "Mama Wanjiku", litres: "2.0" },
  ];
  await db.insert(s.customer).values({
    id: coop, farmId: FARM, name: "Limuru Dairy Co-operative", customerType: "COOP",
    areaClass: "RURAL", fulfilment: "DELIVERED", paymentTerms: "MONTHLY", settlementDay: 20,
  });
  await db.insert(s.customer).values({
    id: school, farmId: FARM, name: "St Mary's Primary School", customerType: "INSTITUTION",
    institutionKind: "SCHOOL", areaClass: "RURAL", fulfilment: "DELIVERED",
    paymentTerms: "NET_30", requiresInvoice: true, requiresDeliveryNote: true,
    creditLimitKes: "60000.00",
  });
  for (const h of households) {
    const cid = id();
    await db.insert(s.customer).values({
      id: cid, farmId: FARM, name: h.name, customerType: "HOUSEHOLD",
      areaClass: "RURAL", fulfilment: "DELIVERED", paymentTerms: "MONTHLY",
      settlementDay: 1, creditLimitKes: "5000.00",
    });
    await db.insert(s.standingOrder).values({
      id: id(), farmId: FARM, customerId: cid, litres: h.litres, session: "MORNING",
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7], activeFrom: "2026-01-01",
    });
  }
  // Schools stop over the holidays — paused, never deleted, so the volume
  // forecast survives December.
  await db.insert(s.standingOrder).values({
    id: id(), farmId: FARM, customerId: school, litres: "30.0", session: "MORNING",
    daysOfWeek: [1, 2, 3, 4, 5], activeFrom: "2026-01-08",
    pausedFrom: "2026-08-09", pausedTo: "2026-08-30",
  });

  /* ---- Prices. Effective-dated, because they swing ~40% intra-year. ---- */
  await db.insert(s.priceList).values([
    { id: id(), farmId: FARM, scope: "CHANNEL", customerType: "COOP", rateKesPerLitre: "52.00", effectiveFrom: "2026-08-01", reason: "Government farm-gate benchmark", setBy: owner },
    { id: id(), farmId: FARM, scope: "CHANNEL", customerType: "INSTITUTION", rateKesPerLitre: "65.00", effectiveFrom: "2026-01-08", reason: "School contract", setBy: owner },
    { id: id(), farmId: FARM, scope: "CHANNEL", customerType: "HOUSEHOLD", rateKesPerLitre: "70.00", effectiveFrom: "2026-01-01", reason: "Doorstep delivery", setBy: owner },
  ]);

  /* ---- Feed ---- */
  const dairyMeal = id();
  const hay = id();
  const napier = id();
  const minerals = id();
  await db.insert(s.feedItem).values([
    { id: dairyMeal, farmId: FARM, name: "Dairy meal (Unga)", category: "CONCENTRATE", dmPct: "88.00", cpPct: "16.00", defaultUnit: "BAG_70KG", defaultUnitWeightKg: "70" },
    { id: hay, farmId: FARM, name: "Boma Rhodes hay", category: "FODDER", dmPct: "88.00", cpPct: "8.00", defaultUnit: "BALE", defaultUnitWeightKg: "15" },
    { id: napier, farmId: FARM, name: "Napier grass (Bana)", category: "FODDER", dmPct: "20.00", cpPct: "9.00", defaultUnit: "WHEELBARROW", defaultUnitWeightKg: "50", homeGrown: true },
    { id: minerals, farmId: FARM, name: "Maclik Super", category: "MINERAL", defaultUnit: "KG", defaultUnitWeightKg: "1" },
  ]);
  await db.insert(s.feedPurchase).values([
    { id: id(), farmId: FARM, feedItemId: dairyMeal, purchasedOn: "2026-07-28", quantity: "12", unit: "BAG_70KG", unitWeightKg: "70", unitPriceKes: "3300.00", totalCostKes: "39600.00", recordedBy: manager },
    { id: id(), farmId: FARM, feedItemId: hay, purchasedOn: "2026-07-20", quantity: "60", unit: "BALE", unitWeightKg: "15", unitPriceKes: "300.00", totalCostKes: "18000.00", recordedBy: manager },
  ]);

  /* ---- Drug master. Withdrawal comes from the label, never a lookup table. ---- */
  await db.insert(s.product).values([
    { id: id(), farmId: FARM, name: "Oxytetracycline LA 20%", activeIngredient: "Oxytetracycline", productType: "ANTIBIOTIC", milkWithdrawalDays: 7, meatWithdrawalDays: 28, labelSource: "PCPB-approved label" },
    { id: id(), farmId: FARM, name: "Penstrep", activeIngredient: "Procaine penicillin + streptomycin", productType: "ANTIBIOTIC", milkWithdrawalDays: 3, meatWithdrawalDays: 14, labelSource: "PCPB-approved label" },
    { id: id(), farmId: FARM, name: "Albendazole 10%", activeIngredient: "Albendazole", productType: "DEWORMER", milkWithdrawalDays: 4, meatWithdrawalDays: 14, labelSource: "PCPB-approved label" },
    { id: id(), farmId: FARM, name: "Triatix (amitraz)", activeIngredient: "Amitraz", productType: "ACARICIDE", milkWithdrawalDays: 0, meatWithdrawalDays: 1, labelSource: "PCPB-approved label" },
    { id: id(), farmId: FARM, name: "Ivermectin injectable", activeIngredient: "Ivermectin", productType: "DEWORMER", meatWithdrawalDays: 49, notForLactating: true, labelSource: "PCPB-approved label — NOT for lactating dairy cattle" },
  ]);

  /* ---- Compliance, with real expiry dates so the alerts have something to fire on ---- */
  await db.insert(s.complianceDocument).values([
    { id: id(), farmId: FARM, docType: "KDB_PERMIT", referenceNo: "KDB/2026/8841", issuedOn: "2026-01-15", expiresOn: "2027-01-14", costKes: "1800.00" },
    { id: id(), farmId: FARM, docType: "MILK_TRANSPORT_PERMIT", referenceNo: "MTP/2026/2210", issuedOn: "2026-02-01", expiresOn: "2027-01-31", costKes: "1000.00" },
    { id: id(), farmId: FARM, docType: "COUNTY_BUSINESS_PERMIT", referenceNo: "KMB/SBP/9930", issuedOn: "2026-01-05", expiresOn: "2026-12-31", costKes: "5000.00" },
  ]);

  /* ---- Reference data used by the rules ---- */
  await db.insert(s.referenceValue).values([
    { id: id(), farmId: FARM, kind: "CBK_BASE_RATE", key: "PCT_PER_ANNUM", valueNumeric: "9.7500", effectiveFrom: "2026-06-01", source: "CBK" },
    { id: id(), farmId: FARM, kind: "FEED_RULE", key: "LITRES_PER_KG_CONCENTRATE", valueNumeric: "1.5000", effectiveFrom: "2026-01-01", source: "NAFIS" },
    { id: id(), farmId: FARM, kind: "FEED_RULE", key: "BASELINE_LITRES", valueNumeric: "8.0000", effectiveFrom: "2026-01-01", source: "NAFIS" },
  ]);

  await pg.close();
  console.log(`Seeded "Wanjiru Farm, Kiambu" into ${path}.`);
  console.log("Sign in as any of Grace, Peter, Kamau or Otieno. Every PIN is 1234.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

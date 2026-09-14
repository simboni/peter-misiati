/**
 * Create (or top up) a facility database with reference data and a demo clinic.
 *
 *   npm run seed
 *
 * Idempotent — safe to run against an existing database.
 */
import { seedDemo } from "../src/lib/seed.ts";
import { verifyAuditChain, closeDb } from "../src/lib/db.ts";
import { facilityCompliance } from "../src/lib/facility.ts";

const { facilityId } = seedDemo();

console.log(`Seeded facility #${facilityId} (Demo Medical Clinic).`);
console.log(`Sign in as  admin / ChangeMe123  — you will be asked to change it.`);

const flags = facilityCompliance(facilityId);
if (flags.length) {
  console.log(`\nOutstanding compliance items:`);
  for (const f of flags) console.log(`  [${f.severity.toUpperCase()}] ${f.message}`);
}

const chain = verifyAuditChain();
console.log(`\nAudit chain: ${chain.ok ? `intact (${chain.checked} entries)` : `BROKEN at #${chain.failedAtId}`}`);

closeDb();

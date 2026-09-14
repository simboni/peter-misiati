# Afya Core

Kenya-compliant hospital management system (HMIS). Built to the plan in
[`docs/hms/`](../../docs/hms/) at the repository root.

**Current state: Phase 0 complete, Phase 1 started** — M00 Platform Core, M01
Identity & Access, M02 Audit, M03 Sync Engine, M10 Patient Registry & MPI.
Encounters, billing and the claim scrubber are next.

## Running it

```bash
npm install
npm run seed     # creates data/afya.db with a demo clinic and staff
npm run dev      # http://localhost:3200
npm test         # 79 tests, no network or database server needed
```

Sign in as `admin` / `ChangeMe123`.

## Why SQLite, not Postgres

`docs/hms/05-architecture.md` proposed Postgres for the cloud tier. The facility
node ships on SQLite (`node:sqlite`, a Node built-in) because:

- **Offline-first is the product.** A Level 2 clinic loses power and connectivity
  routinely. There is no server to be unable to reach.
- **No database administrator.** The facility's records are one file that can be
  copied, backed up, or carried out on a stick.
- **It matches the repo.** `apps/riziki-pos` runs the same way.

Postgres remains the plan for the cloud sync hub and the multi-branch Network
tier. `src/lib/db.ts` is the only module that would change.

## The modules so far

| Module | File | What it owns |
|---|---|---|
| **M00** Platform Core | `src/lib/facility.ts` | Facility registry (KMHFL, SHA, KRA, ODPC), settings, device registration and revocation |
| **M01** Identity & Access | `src/lib/users.ts`, `src/lib/access.ts` | Named accounts, practitioner licences, roles, permissions, sessions |
| **M02** Audit | `src/lib/db.ts` | Hash-chained append-only audit log, with verification |
| — | `src/lib/ids.ts` | Device-prefixed identifiers that cannot collide offline |
| **M03** Sync Engine | `src/lib/sync.ts` | Offline operation log, Lamport ordering, conflict resolution by data class |
| **M10** Patient Registry & MPI | `src/lib/patients.ts` | Patients, identifier normalisation, duplicate matching, merge and unmerge |
| — | `src/lib/seed.ts` | Cadres, the permission catalogue, default roles |

## Six rules the code enforces

These are compliance requirements expressed as code, not documentation. Each has
a test that fails if it regresses.

1. **A licence gates capability; a role alone does not.** A clinician whose
   council registration lapsed cannot prescribe, diagnose or discharge — because
   claims citing an expired licence are rejected, and the facility only finds out
   two months later. See `src/lib/access.ts`.

2. **The audit log is a hash chain.** Every row stores the digest of the row
   before it. Editing or deleting history breaks the chain, and
   `verifyAuditChain()` names the entry where. Reads of patient data are logged
   with a purpose-of-use, not just writes.

3. **No shared logins, and no self-inflicted lockout.** Usernames are unique per
   facility; the last active administrator cannot be deactivated or demoted.

4. **Nothing minted offline can collide.** Identifiers issued on a device carry
   that device's prefix. Canonical numbers that must be gapless — a KRA eTIMS
   invoice number — are never minted locally; they are assigned on transmission
   and both are kept.

5. **Sync order comes from a Lamport clock, and conflict policy depends on what
   the data is.** Wall time would let a tablet with a fast clock win every
   conflict. Clinical content is never overwritten (both versions kept, a person
   reconciles); stock and money defer to the server with the variance logged;
   demographics merge field by field. Ops carry changed fields only, so a device
   that was offline for two days cannot revert what someone else fixed.

6. **The system never auto-merges two patients.** A strong identifier match is
   definite; everything else is scored, shown with its reasons, and decided by a
   person. Merges are reversible, and two records carrying different national IDs
   are refused outright — one record for two patients is the worst outcome the
   index can produce.

## Testing

```bash
npm test
```

Tests run against a throwaway database in `$TMPDIR` via `AFYA_DB`. No Next.js
import reaches `src/lib/*`, so the domain layer is testable without booting the
framework.

## Next in Phase 1

Remaining for the "Claim-Safe Core" MVP, in dependency order: M11 Consent, M14
Queue & Triage, M21 Terminology (ICD-11), M20 Encounter, M23 Prescribing, M50
Billing, M52 eTIMS, M53 Payer & Coverage, M54 Pre-authorisation, and M55 the
Claims Engine and scrubber.

Per the roadmap, the scrubber's rules should be built from 50 real rejected
claims before the rest — encoding what SHA already rejected beats guessing.

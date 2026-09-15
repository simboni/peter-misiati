# Afya Core

Kenya-compliant hospital management system (HMIS). Built to the plan in
[`docs/hms/`](../../docs/hms/) at the repository root.

**Current state: Phase 1 "Claim-Safe Core" is functionally complete.** A patient
can be registered, checked in, triaged, consulted, diagnosed, prescribed for,
billed, invoiced through eTIMS and claimed for — with the scrubber checking
every claim against nine documented SHA rejection causes before it leaves the
building.

What remains before a facility could actually run on this is listed under
[Not done](#not-done-be-clear-about-this) — read that before showing it to a
clinic.

## Running it on a Mac, from nothing

You need **Node.js 22.6 or newer** — the system uses Node's built-in SQLite and
its TypeScript support, so there is no database server to install and no build
toolchain. That is the only prerequisite.

**1. Install Node.js.** Either download the LTS installer from
[nodejs.org](https://nodejs.org) and run it, or if you have Homebrew:

```bash
brew install node
```

Then confirm it worked — this must print v22.6 or higher:

```bash
node --version
```

**2. Get the code.** From your home folder:

```bash
cd ~
git clone https://github.com/simboni/peter-misiati.git
cd peter-misiati
git checkout claude/hospital-management-research-damdg2
cd apps/afya-core
```

macOS will offer to install the Xcode Command Line Tools the first time you run
`git`. Accept it, wait, then run the clone again.

**3. Install and run.**

```bash
npm install      # ~30 seconds
npm run demo     # loads a clinic morning: 6 patients, a queue, claims
npm run dev      # then open http://localhost:3200
```

Sign in with any of these — the password is `ChangeMe123` for all three, and
each sees a genuinely different system:

| Username | Role | What they can do |
|---|---|---|
| `admin` | Facility Administrator | Dashboard, claims, users, devices. **Cannot** register patients or prescribe |
| `a.wanjiru` | Clinician | Queue, consultations, diagnose, prescribe. Licence-gated |
| `j.otieno` | Receptionist | Register, search, check in, take payment. **Cannot** prescribe |

Stop the server with `Ctrl-C`. To wipe and start over: `rm -rf data && npm run demo`.

```bash
npm test         # 173 tests, no network or database server needed
```

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
| **M21** Terminology | `src/lib/terminology.ts` | Coded catalogues, verified-only coding search, favourites, coverage |
| **M20** Encounter | `src/lib/encounters.ts` | Consultations, append-only notes, coded diagnoses, readiness |
| **M23** Prescribing | `src/lib/prescribing.ts` | Formulary, allergies, graded safety warnings, prescriptions |
| **M11 / M14** Consent, Queue & Triage | `src/lib/frontdesk.ts` | Versioned granular consent, priority queue, vitals |
| **M53 / M54** Payer, Coverage, Pre-auth | `src/lib/payers.ts` | Payers, benefit rules, verification with offline fallback, pre-authorisation |
| **M50 / M52** Billing & eTIMS | `src/lib/billing.ts` | Services, dated tariffs, charges, invoices, payments, eTIMS queue, leakage report |
| **M55** Claims Engine | `src/lib/claims.ts` | Claim assembly, **the nine-gate scrubber**, submission, outcomes, dashboard |
| — | `src/lib/seed.ts` | Cadres, permissions, roles, ICD-11 and formulary starter sets |

## Thirteen rules the code enforces

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

7. **An unverified code can never reach a claim.** A wrong diagnosis code is a
   named SHA rejection cause, so only codes checked against the issuing authority
   are offered for coding. A guessed code is worse than none: no code stops at
   the scrubber, a wrong one is paid and then clawed back.

8. **The licence is pinned when care is given, and an encounter cannot close
   without a coded primary diagnosis.** A claim cites the practitioner's
   registration as it stood on the day, so it is copied onto the encounter rather
   than resolved later. And the diagnosis is demanded while the clinician is
   still with the patient — the cheapest moment in the whole revenue cycle to
   fix it.

9. **Only one grade of warning interrupts.** A severe or anaphylactic allergy
   blocks prescribing and needs a written override; a mild allergy informs and
   stops nothing; a controlled drug flags the pharmacy, not the prescriber. A
   system that blocks on everything teaches clinicians to override reflexively,
   and then the warning that mattered is overridden too.

10. **An override is only recorded when something was actually overridden.** A
    stale reason carried forward from a previous attempt is dropped, because a
    record claiming a prescriber overrode a warning they were never shown is a
    lie in a clinical record.

11. **A payer being unreachable never blocks care.** Verification degrades
    through online → cached → provisional → emergency, and the flag is never
    laundered: a provisional verification reaches the scrubber as provisional.
    When SHA's pre-authorisation platform failed nationwide in March 2026,
    facilities had no fallback. This is that fallback.

12. **Money is integer cents, and a price is fixed as of the date of service.**
    A tariff revised last month must not silently reprice care given before it,
    and an unpriced line is refused rather than billed at zero.

13. **A claim is validated before it is created, not on day six.** Nine gates,
    each mapped to a documented rejection cause, each naming the person who can
    fix it. A blocked claim cannot reach the payer, and the verdict it was
    checked against is stored so a rejection can be compared with what we
    believed at submission.

## Testing

```bash
npm test
```

Tests run against a throwaway database in `$TMPDIR` via `AFYA_DB`. No Next.js
import reaches `src/lib/*`, so the domain layer is testable without booting the
framework.

## The ICD-11 catalogue — read before go-live

The seed ships **ten ICD-11 codes**, each checked individually against the
published MMS classification. Codes that could not be confirmed were left out
rather than guessed, because an invented code causes exactly the rejection this
system exists to prevent.

That is not a catalogue. The same applies to the **starter formulary**: its PPB
registration numbers are placeholders, and the real PPB register must be loaded
with `importProducts` before anything is dispensed.

Before go-live, load the full WHO ICD-11 MMS release:

```ts
importCodes({ system: ICD11, source: "WHO ICD-11 MMS <release>", concepts: [...] });
```

`coverage()` reports `starterOnly: true` until it is, and the consultation screen
says so on every visit — a clinician who cannot find their diagnosis picks
something close instead, which is how wrong codes reach claims.

## The consultation budget

Design principle P3: a standard outpatient consultation in under 90 seconds and
under 15 interactions. Measured against the running app on 15 September 2026:

| Path | Interactions | Seconds |
|---|---|---|
| Coding by search (first use of a code) | 10 / 15 | ~9 / 90 |
| Coding by favourite chip (thereafter) | 8 / 15 | ~7.5 / 90 |

`scripts/consultation-budget.mjs` measures it. It is **not** part of `npm test` —
it needs a running server and a browser, and the app carries no browser-test
dependency yet. Wiring it into CI is outstanding.

## The nine gates

`scrub()` in `src/lib/claims.ts`. Each maps to a documented SHA rejection cause.

| # | Gate | Fails when | Routed to |
|---|---|---|---|
| 1 | Member verification | No cover, inactive, or only provisionally verified | Reception |
| 2 | Pre-authorisation | A service that needs it has no approval | Claims officer |
| 3 | Diagnosis | No primary diagnosis, or an unverified code | Clinician |
| 4 | Benefit package | A line the payer does not cover | Claims officer |
| 5 | Tariff | A line with no dated tariff behind it | Administrator |
| 6 | Dates | Service in the future, or discharge before admission | Claims officer |
| 7 | Documentation | Names exactly what is missing, never "incomplete" | Clinician / claims |
| 8 | Signature | No pinned licence, or the encounter is still open | Clinician |
| 9 | Submission window | Past the payer's window — **escalates**, does not block | Claims officer |

Gate 9 escalates rather than blocking because a late claim still has an appeal
path, and hiding it helps nobody. Submitting one needs an explicit written
reason, which is recorded.

## Not done — be clear about this

Phase 1 is functionally complete, but a facility cannot run on it yet:

- **No real payer adapter.** `PayerProbe`, `ClaimSubmitter` and
  `EtimsTransmitter` are injection points with deliberately honest defaults —
  "no adapter is configured", so everything queues and stays visible. The SHA
  and KRA specifications are needed to write the real ones.
- **The ICD-11 catalogue is 10 verified codes**, and the **PPB registrations in
  the formulary are placeholders**. Both are loaders; both need the real
  registers.
- **Tariffs and benefit rules are illustrative.** The SHA schedule for the
  contracting cycle must be loaded before any of the pricing means anything.
- **The scrubber's rules are inferred from documented rejection causes, not
  from 50 real rejected claims.** The roadmap says to build them from a real
  corpus, and that is still the right next step — `recordOutcome` captures
  every rejection reason and `claimsSummary` ranks them by cost, so the rule
  set improves from real data rather than guesswork.
- **Not yet built:** dispensing and stock (M40/M41), laboratory (M30),
  radiology, inpatient wards, theatre, maternity, DHIS2 submission, the patient
  portal. Phases 2–5 of the roadmap.
- **No CI.** Tests, typecheck and build all pass locally and are run on every
  change by hand; nothing enforces that automatically.

# Afya Core

Kenya-compliant hospital management system (HMIS). Built to the plan in
[`docs/hms/`](../../docs/hms/) at the repository root.

**Current state: every module on the roadmap is built — 46 of them, 859 tests,
thirty-five screens.** A patient is registered, checked in, triaged, consulted,
diagnosed, prescribed for, investigated in the laboratory, dispensed to from
batch-tracked stock, admitted to a bed, billed, invoiced through eTIMS and
claimed for — with the scrubber checking every claim against nine documented SHA
rejection causes before it leaves the building, and the monthly MOH returns
generated from those same transactions rather than re-keyed. Around that spine
sit casualty, theatre, maternity, referrals, radiology, the programme registers,
procurement, the ledger, payroll, HR, the asset register and cold chain, the
mortuary, biometric identity, the analyser interface, the dashboard, an SMS
patient portal, telemedicine, and a configuration studio.

**What is not finished is the sign-off.**
[`docs/hms/06-clinical-review.md`](../../docs/hms/06-clinical-review.md) lists
every clinical and regulatory rule the code enforces, with its source, and
sixty-four items that must be replaced or confirmed before go-live. Most are not
defects — they are numbers nobody has yet put their name against, which is what
the configuration studio is for. Read it, and
[Not done](#not-done-be-clear-about-this), before showing this to a clinic.

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

Sign in with any of these — the password is `ChangeMe123` for all five, and each
sees a genuinely different system. The navigation is filtered by capability, not
by role name: a pharmacist has no claims tab because they cannot submit claims,
which is the same fact that stops them if they type the URL.

| Username | Who | What they can do |
|---|---|---|
| `admin` | Facility Administrator | Compliance, integrations, staff, devices, tariffs, claims, the front desk. **Cannot** prescribe or dispense |
| `a.wanjiru` | Dr. Achieng Wanjiru | Queue, consultations, diagnose, prescribe, order, admit, discharge. Licence-gated |
| `j.otieno` | Joseph Otieno | Register, search, check in, book appointments, take payment. **Cannot** prescribe |
| `g.kimani` | Grace Kimani | The pharmacy counter, stock, the controlled-drug register |
| `s.mutiso` | Samuel Mutiso | The laboratory bench. Releasing a result needs his KMLTTB registration |

Two-factor codes for `admin` and `g.kimani` come from the secret
`JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` — enter it in any authenticator app. It is a
demonstration value, published on purpose; a real facility enrols each person
with a secret nobody else has ever seen.

Stop the server with `Ctrl-C`. To wipe and start over: `rm -rf data && npm run demo`.

```bash
npm test         # 859 tests, no network or database server needed
```

## Showing it to a client

`npm run demo` loads a clinic that has been working: patients in the queue,
medicine dispensed off real batches, a result released, a patient two nights into
a ward stay and getting better, claims in several states, and the month's MOH
returns. Twenty minutes, in this order.

**1. The dashboard (`admin`).** One screen answering the only two questions a
facility owner has: am I going to get paid, and am I going to pass an inspection.
What is blocking claims, what expires soon, the acceptance rate, the revenue
leakage, and the audit chain verified live.

**2. A consultation (`a.wanjiru`).** Open the queue, take the next patient,
code a diagnosis, prescribe. Try prescribing amoxicillin to Faith Chebet — she
has a recorded severe allergy, and it blocks and demands a written override.
Close the consultation: it will refuse without a coded primary diagnosis.

**3. The laboratory (`s.mutiso`).** A stat urinalysis is on the bench. Enter a
reading, then release it. Point out that until it is released nothing has reached
the clinician — and that releasing it attaches the report to the encounter, which
is what clears the claim's documentation gate.

**4. The pharmacy (`g.kimani`).** The counter shows what can be filled before
anything is committed, and which batch would go out. Dispense one. Then open
Stock: the stock came off the shelf, the charge went on the bill, the
prescription closed and the controlled register updated — one event, four
consequences, none of them re-keyed.

**5. The ward (`a.wanjiru`).** Peter Omondi is in GEN-1, two nights in, with a
NEWS2 trend running 9 → 5 → 0 and a drug chart showing one dose given and one
withheld with its reason. Note that the transfer list offers no maternity bed.

**6. Claims (`admin`).** The nine gates, each mapped to a documented SHA
rejection cause and each naming the person who can fix it. Show a claim that is
blocked and why.

**7. Reports (`admin`).** MOH 705A, 705B and 717, generated from the
transactions above. Nothing on that screen was typed twice.

**8. Administration (`admin`).** The integrations table, where every endpoint
says plainly that it is running a simulator. Try switching SHA to live — it is
refused, because no live adapter exists yet. Then type a malformed KRA PIN and
watch it be refused with a sentence rather than an error page.

Be straight with the client about what the integrations table is telling them:
**the SHA and KRA connections are simulated until those specifications are in
hand.** Everything either side of them is real.

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
| **M55** Claims Engine | `src/lib/claims.ts` | Claim assembly, **the nine-gate scrubber**, submission, outcome polling, dashboard |
| **M04** Integration Hub | `src/lib/integration.ts` | The only way out of the building: retries, dead letters, credential redaction, and three modes with the mode always visible |
| **M05** Notifications | `src/lib/notifications.ts` | The SHA claim clock, licence expiry, eTIMS backlog, dead letters — each on the desk of the role that can act |
| **M06** Document Store | `src/lib/documents.ts` | Attachments with their digests, and signatures that stop matching when the content is amended |
| **M41** Inventory & Stores | `src/lib/inventory.ts` | Batch-level stock, first-expiry-first-out, stock takes, recalls, the controlled-drug register |
| **M40** Pharmacy | `src/lib/pharmacy.ts` | Dispensing — one event, four consequences. Substitution, partial dispensing |
| **M22** Orders (CPOE) | `src/lib/orders.ts` | Lab, imaging and procedure orders; the acknowledgement state that closes the loop |
| **M30** Laboratory | `src/lib/laboratory.ts` | Specimens, reference ranges matched to the patient, release by a licensed technologist, panic values |
| **M13** Scheduling | `src/lib/scheduling.ts` | Slots, bookings, reminders through the hub, booked-against-seen |
| **M24** Inpatient & Ward | `src/lib/inpatient.ts` | Beds, admissions, NEWS2, the drug chart, bed nights, discharge |
| **M70 / M71** MOH Returns & KHIS | `src/lib/reporting.ts` | MOH 705A/705B/717 generated from transactions, frozen once sent, pushed to DHIS2 |
| **M28** Casualty | `src/lib/emergency.ts` | Triage scoring and time targets, the unidentified patient, mass casualty incidents |
| **M25** Theatre | `src/lib/theatre.ts` | The WHO checklist as a gate rather than a form, swab and instrument counts |
| **M26 / M27** Maternity & Child Health | `src/lib/maternity.ts` | Antenatal contacts, delivery, the baby's own file, KEPI immunisation |
| **M29** Referrals | `src/lib/referrals.ts` | Sending a patient on, and the letter that comes back — the loop that usually stays open |
| **M32** Radiology | `src/lib/radiology.ts` | Justification, the pregnancy question, MRI screening, cumulative dose |
| **M33** Programme Registers | `src/lib/programmes.ts` | HIV, TB and NCD cohorts, defaulter tracing, retention |
| **M42** Procurement | `src/lib/procurement.ts` | Requisitions, orders, three-way matching, AGPO, no self-approval |
| **M61** Accounting | `src/lib/accounting.ts` | Double-entry ledger derived from operations, trial balance, reconciliation |
| **M62** Payroll | `src/lib/payroll.ts` | PAYE, NSSF, SHIF and the housing levy, in the order the law applies them |
| **M60** Human Resources | `src/lib/hr.ts` | Leave with licensed cover, contracts, registrations, disciplinary process |
| **M63** Assets & Maintenance | `src/lib/assets.ts` | The register, blocking safety checks, the cold chain, depreciation |
| **M64** Mortuary | `src/lib/mortuary.ts` | The part of the system with no undo: identity, authority, release |
| **M12** Biometric Verification | `src/lib/biometrics.ts` | Fingerprints where they work, and a first-class record of where they do not |
| **M31** Analyser Interface | `src/lib/analysers.ts` | ASTM and HL7 parsing, code and unit mapping, and what must never be filed |
| **M72** Analytics | `src/lib/indicators.ts` | Indicators with their definitions attached, and the rates it refuses to print |
| **M73** Patient Portal | `src/lib/portal.ts` | An SMS portal, and the findings that never reach a phone |
| **M74** Telemedicine | `src/lib/telemedicine.ts` | A remote consultation on an ordinary encounter, and what cannot be done down a telephone |
| **M75** Configuration Studio | `src/lib/configuration.ts` | The thresholds a facility owns, and a named person's signature against each |
| — | `src/lib/totp.ts` | RFC 6238 two-factor codes, checked against the RFC's own test vectors |
| — | `src/lib/seed.ts` | Cadres, permissions, roles, ICD-11, formulary, stores, wards, reference ranges |

## Eighteen rules the code enforces

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

14. **A simulated answer is never mistakable for a real one.** Every endpoint
    runs in `demo`, `live` or `disabled`, the mode is on the integrations
    screen, every result carries `simulated`, and the integration log records
    which mode each call ran in. Switching to live is refused while no live
    adapter exists, because the alternative is a facility believing it is
    claiming when it is not. Credentials are redacted before anything is
    logged, because the log goes to auditors.

15. **Stock is held per batch, the ledger is append-only, and picking is
    first-expiry-first-out.** A recall names a batch; an expiry belongs to a
    batch; a pharmacist asked which batch a patient received must be able to
    answer. A correction is another movement with a reason, never an edit, so
    the sum of movements equals what is on the shelf and a discrepancy has a
    history rather than a mystery.

16. **One event, four consequences.** A pharmacist hands medicine over once,
    and the stock ledger, the bill, the prescription and the controlled
    register all move in the same transaction. If any would fail, none of them
    happened — there is a test that proves it, because a shelf and a bill that
    disagree never agree again.

17. **A reading is not a result, and a panic value is a phone call.** A number
    off the analyser becomes a result when a KMLTTB-registered technologist
    releases it, and only then does it reach a clinician. Releasing a critical
    value raises an alert on the ordering clinician's desk in the same
    transaction, so "nobody saw it" is not available as an outcome. A result
    stays outstanding until somebody says they have read it.

18. **A second factor is proved, not merely enrolled.** TOTP written against
    RFC 6238 and checked against the RFC's own vectors, so it agrees with
    Google Authenticator rather than only with itself. A code proved at
    sign-in or stepped up stays good for fifteen minutes; an MFA-gated action
    needs a recent one on that session, so a machine left signed in at a
    counter cannot dispense a controlled drug an hour after the pharmacist
    walked away.

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
| 7 | Documentation | No assessment, no invoice, or a document the payer's benefit rule requires is genuinely not attached | Clinician / claims |
| 8 | Signature | No pinned licence, the encounter is still open, or the record was amended after it was signed | Clinician |
| 9 | Submission window | Past the payer's window — **escalates**, does not block | Claims officer |

Gate 9 escalates rather than blocking because a late claim still has an appeal
path, and hiding it helps nobody. Submitting one needs an explicit written
reason, which is recorded.

## Not done — be clear about this

The system runs end to end, but a facility cannot go live on it yet:

- **The SHA and KRA connections are simulated.** This is the one to say out
  loud in any demonstration. The integration hub runs deterministic simulators
  that apply the published rules and refuse malformed requests, and every
  answer they give is stamped `simulated` on screen and in the log. They exist
  so the whole flow can be shown before the integrations exist. Writing the
  live adapters needs the SHA HMIS and KRA eTIMS specifications; switching an
  endpoint to live is refused until one is registered. The same is true of the
  SMS gateway (needs a licensed Kenyan aggregator) and KHIS (needs facility
  credentials for the national instance).
- **The ICD-11 catalogue is 10 verified codes**, and the **PPB registrations in
  the formulary are placeholders**. Both are loaders; both need the real
  registers. `coverage()` reports `starterOnly` until then and the dashboard
  says so.
- **Tariffs, benefit rules and laboratory reference ranges are illustrative.**
  The SHA schedule for the contracting cycle must be loaded before the pricing
  means anything, and a facility running its own analyser must load the ranges
  that analyser was validated against — a flag from somebody else's instrument
  is a flag nobody trusts.
- **The scrubber's rules are inferred from documented rejection causes, not
  from 50 real rejected claims.** `recordOutcome` captures every rejection
  reason and `claimsSummary` ranks them by cost, so the rule set improves from
  real data — but that corpus does not exist yet.
- **The notifiable-disease list is four conditions.** The full Public Health
  Act schedule must be loaded before go-live.
- **Sync has no network transport.** `src/lib/sync.ts` has the operation log,
  the Lamport ordering and the conflict policy, and they are tested. What is
  missing is the code that moves ops between two machines.
- **Not yet built:** radiology, theatre, maternity, the patient portal,
  procurement, telemedicine. Phases 3–5 of the roadmap.
- **No CI.** Tests, typecheck and build all pass and are run on every change by
  hand; nothing enforces that automatically.
- **NEWS2 omits two components.** The consciousness and supplemental-oxygen
  scores are not recorded yet, so the score under-reads rather than over-reads
  and the escalation threshold is set accordingly.

# Hospital Management System — Research & Build Plan

Research pack and build plan for a Kenya-compliant Hospital Management Information System (HMIS).

**Prepared:** 14 September 2026 · **Market:** Kenya, then East Africa

---

## The situation in one paragraph

SHA has made a DHA-certified HMIS mandatory for any provider that wants to participate in the 2026/28 contracting cycle, with a compliance deadline of **30 September 2026**. Of 5,078 facilities on SHA HMIS, only 2,978 are actually submitting claims electronically. Around **20% of claim value** is rejected, returned or stuck awaiting documents, and facilities have gone six months without payment. Every facility in Kenya must buy or replace software, and the market leaders are weakest precisely where the pain is: offline resilience and claim acceptance.

## The product thesis

> **The HMIS that gets you paid.** Certified, offline-proof, and it tells you a claim will be rejected *before* you submit it.

## The documents

| Document | What is in it |
|---|---|
| [01 — Market Research](01-market-research.md) | The deadline-driven opportunity, competitor-by-competitor analysis (commercial, open-source, enterprise), pricing, and **ten specific weaknesses (W1–W10)** that become our design targets |
| [02 — Compliance Matrix](02-compliance-matrix.md) | Every regulator, and the hard requirements — DHA certification, SHA claims, Data Protection Act, KRA eTIMS, PPB, MOH reporting — as engineering requirements with a risk register |
| [03 — Product Specification](03-product-spec.md) | Design principles, roles, **six process flow diagrams** including the claim scrubber, the full feature catalogue, non-functional targets, and an explicit "will not build" list |
| [04 — Module Register & Roadmap](04-module-roadmap.md) | **46 modules** across 8 layers, dependency map, a five-phase build plan, the next 10 working days, pricing, team and risks |
| [05 — Architecture](05-architecture.md) | Offline-first system shape, recommended stack, FHIR data spine, sync conflict policy, integration hub, security posture, CI quality gates |

## Build status

The system is built in [`apps/afya-core`](../../apps/afya-core/). As of
16 September 2026, **every module on the roadmap has been built**: 46 modules,
859 passing tests, and thirty-five screens.

Phase 1 "Claim-Safe Core" is complete — registration, triage, consultation,
coded diagnosis, prescribing, billing, eTIMS and the nine-gate scrubber, which
runs live on the consultation screen while the patient is still in the room.
On top of it sit the integration hub, notifications, the document store,
batch-tracked stock and dispensing, orders and the laboratory, scheduling, the
inpatient ward, two-factor authentication, and MOH 705A/705B/717 returns
generated from the transactions rather than re-keyed.

Phases 2 to 5 followed: casualty and mass casualty, theatre with the WHO
checklist, maternity and child health, referrals that close their loop,
radiology with dose tracking, the programme registers, procurement, the general
ledger, payroll against the statutory rates, human resources, the asset
register and cold chain, the mortuary, biometric identity, the analyser
interface, the dashboard, the SMS patient portal, telemedicine, and the
configuration studio.

**The thing that is not finished is the sign-off.**
[06 — Clinical review](06-clinical-review.md) lists every rule the code
enforces, with its source, across twenty-five sections — and sixty-four items
that must be replaced or confirmed before go-live. Most of them are not defects;
they are numbers nobody has yet put their name against, and the configuration
studio exists so that a facility can.

`npm run demo` loads a clinic that has been working — patients in the queue,
medicine dispensed off real batches, a released result, a ward patient two
nights in and improving, claims in several states, and the month's returns.
The [app README](../../apps/afya-core/README.md#showing-it-to-a-client) has a
twenty-minute script for walking a client through it.

**Say this out loud in any demonstration: the SHA and KRA connections are
simulated.** The integration hub runs deterministic simulators that apply the
published rules and refuse malformed requests, and every answer they give is
stamped `simulated` on screen and in the log. Writing the live adapters needs
those specifications. That and everything else still outstanding is listed in
the [app README](../../apps/afya-core/README.md#not-done-be-clear-about-this).

## Where to start

1. Read [01 §3 — the ten weaknesses](01-market-research.md#3-weak-points--the-specific-things-everyone-gets-wrong). Every design decision traces back to one of them.
2. Read [04 §3 — the roadmap](04-module-roadmap.md#3-the-step-by-step-roadmap). Phase 1 is 17 modules and is the whole commercial bet.
3. Execute [04 §4 — the next 10 working days](04-module-roadmap.md#4-immediate-next-10-working-days). Day 1 is DHA vendor registration, because it has the longest lead time and will otherwise become the critical path.

## The three things that decide whether this works

1. **Claim acceptance rate.** It is the only number the facility owner cares about, and the one metric no incumbent publishes. Build the scrubber against 50 real rejected claims before writing the rest.
2. **Offline-first, from week 5.** Both market leaders lack full offline capability. It cannot be retrofitted — prototype the sync engine before anything depends on it.
3. **Two part-time domain experts.** A clinical advisor and a claims specialist. Every documented HMIS failure traces back to software built without someone who has worked the counter.

> **Disclaimer:** this is an engineering and commercial plan, not legal advice. Have the DPIA, consent wording, data-processing agreement and the DHA/SHA submission pack reviewed by a Kenyan advocate practising in health and data protection before commercial launch.

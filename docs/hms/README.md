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
| [04 — Module Register & Roadmap](04-module-roadmap.md) | **48 modules** across 8 layers, dependency map, a five-phase build plan, the next 10 working days, pricing, team and risks |
| [05 — Architecture](05-architecture.md) | Offline-first system shape, recommended stack, FHIR data spine, sync conflict policy, integration hub, security posture, CI quality gates |

## Where to start

1. Read [01 §3 — the ten weaknesses](01-market-research.md#3-weak-points--the-specific-things-everyone-gets-wrong). Every design decision traces back to one of them.
2. Read [04 §3 — the roadmap](04-module-roadmap.md#3-the-step-by-step-roadmap). Phase 1 is 17 modules and is the whole commercial bet.
3. Execute [04 §4 — the next 10 working days](04-module-roadmap.md#4-immediate-next-10-working-days). Day 1 is DHA vendor registration, because it has the longest lead time and will otherwise become the critical path.

## The three things that decide whether this works

1. **Claim acceptance rate.** It is the only number the facility owner cares about, and the one metric no incumbent publishes. Build the scrubber against 50 real rejected claims before writing the rest.
2. **Offline-first, from week 5.** Both market leaders lack full offline capability. It cannot be retrofitted — prototype the sync engine before anything depends on it.
3. **Two part-time domain experts.** A clinical advisor and a claims specialist. Every documented HMIS failure traces back to software built without someone who has worked the counter.

> **Disclaimer:** this is an engineering and commercial plan, not legal advice. Have the DPIA, consent wording, data-processing agreement and the DHA/SHA submission pack reviewed by a Kenyan advocate practising in health and data protection before commercial launch.

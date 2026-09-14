# Regulatory & Compliance Matrix

**Scope:** what the system must do to be legally deployable in a Kenyan health facility, and who checks.

> **Note:** this is an engineering compliance specification, not legal advice. Before commercial launch, have the DPIA, the patient-consent wording, the data-processing agreement and the SHA/DHA submission pack reviewed by a Kenyan advocate with health and data-protection practice.

---

## 1. The regulators

| Body | What it governs | What it means for the build |
|---|---|---|
| **Digital Health Agency (DHA)** | Certification of digital health systems; the national Health Information Exchange (HIE); vendor registration | We must be a **registered vendor** with a **certified HMIS**. Non-negotiable, gates everything else. |
| **Social Health Authority (SHA)** | Provider contracting, member verification, benefits, e-claims, tariffs | Real-time verification + electronic claims + pre-authorisation against SHA HMIS (Taifa Care) |
| **Ministry of Health (MOH)** | Health Act 2017, KMHFL facility codes, reporting standards | MOH return forms, KHIS/DHIS2 submission, facility & programme codes |
| **Office of the Data Protection Commissioner (ODPC)** | Data Protection Act 2019 | Controller/processor registration, consent, breach notification, DPIA |
| **Kenya Revenue Authority (KRA)** | Tax Procedures Act, eTIMS | Every patient encounter ends in a KRA-compliant electronic invoice |
| **Pharmacy & Poisons Board (PPB)** | Drug registration, dispensing, controlled substances | Registered-product catalogue, prescriber identity, controlled-drug register |
| **KMPDC / Nursing Council / KMLTTB / Clinical Officers Council** | Practitioner licensing | Practitioner licence number captured and validated per clinical user |
| **Communications Authority / CBK** | Telecoms & payments (SMS, M-Pesa) | Licensed aggregators only; PCI-adjacent handling of payment references |

---

## 2. Hard requirements — the compliance checklist

### C1. DHA certification & HIE connectivity

| # | Requirement | Build implication |
|---|---|---|
| C1.1 | Vendor registered with DHA before deployment | Corporate task — start immediately, it has lead time |
| C1.2 | HMIS certified by DHA against prescribed technical and interoperability standards | Certification test pack must be a tracked engineering deliverable |
| C1.3 | System connects to the national HIE for secure exchange of patient and health information | Integration Hub module with HIE client |
| C1.4 | Use the approved data standard — **HL7 FHIR** | FHIR-native internal resource model; not a mapping layer bolted on later |
| C1.5 | Route via the Health Interoperability Services Layer (ISL) | ISL adapter; support message transformation and routing |
| C1.6 | Exchange information only for authorised purposes | Purpose-of-use tagging on every outbound exchange, logged |

> **Architecture decision:** model our clinical domain on FHIR resources (Patient, Encounter, Condition, Observation, MedicationRequest, Claim, Coverage) from day one. Retrofitting FHIR onto a bespoke schema is the single most expensive mistake available to us.

### C2. SHA claims integration

| # | Requirement | Build implication |
|---|---|---|
| C2.1 | Real-time member/patient verification | Verification service, cached, with offline queue |
| C2.2 | Biometric authentication where deployed | Fingerprint device integration (county rollouts already underway) |
| C2.3 | OTP authorisation path | OTP capture; **OTP-only permitted for identified emergency patients at check-in** |
| C2.4 | Emergency (ECCIF) claims | Unidentified emergency patients submitted without OTP/biometrics, with a reason selected from SHA's backend catalogue |
| C2.5 | Pre-authorisation for services that require it | Preauth request/track/attach-to-claim; **no preauth = automatic rejection**, so block submission |
| C2.6 | Electronic claim submission | Claim builder + validator + submitter + status poller |
| C2.7 | **Submission within 7 days** of service | Countdown timer per claim; escalating alerts at day 3, 5, 6 |
| C2.8 | Correct clinical and tariff coding | ICD-11 diagnosis coding, SHA benefit package and tariff mapping |
| C2.9 | Complete documentation and signatures | Digital signature capture; document-completeness gate before submission |
| C2.10 | Digital authentication of the provider | Facility + practitioner credentials on every claim |

> **This is the product.** Requirements C2.5 through C2.9 are precisely the documented rejection causes. Every one becomes a blocking validation rule.

### C3. Data protection (Data Protection Act 2019)

| # | Requirement | Build implication |
|---|---|---|
| C3.1 | Health data is **sensitive personal data** — elevated protection | Field-level classification; encryption at rest and in transit |
| C3.2 | Facility registers with ODPC as data controller; we register as data processor | Registration valid 24 months, renewable; onboarding checklist item |
| C3.3 | Lawful basis and consent | Consent capture at registration, versioned, withdrawable, auditable |
| C3.4 | Data subject rights — access, correction, erasure, portability | Patient record export (FHIR bundle + PDF); correction workflow with audit |
| C3.5 | Purpose limitation and minimisation | Role-based field visibility; no blanket "admin sees everything" |
| C3.6 | Security safeguards | MFA, per-user accounts, **no shared logins**, session timeout, encrypted backups |
| C3.7 | Breach notification | Detection, incident log, notification workflow and templates |
| C3.8 | Cross-border transfer restrictions | **Kenyan data residency** for production data; documented sub-processors |
| C3.9 | DPIA for high-risk processing | Documented DPIA, maintained per release |
| C3.10 | Data processing agreement between us and each facility | Standard DPA in the contract pack |

### C4. Tax — KRA eTIMS

| # | Requirement | Build implication |
|---|---|---|
| C4.1 | Hospitals must onboard to eTIMS **even though medical services are VAT-exempt** | eTIMS integration is mandatory, not optional |
| C4.2 | Every consultation, procedure, dispensed drug and lab test must be invoiced through eTIMS | Every billable line carries an eTIMS item classification |
| C4.3 | Applies whether the patient pays cash, insurance or corporate scheme | Invoice on service, regardless of payer |
| C4.4 | Every patient encounter ends with a KRA-compliant invoice | Encounter cannot close without an invoice — enforce in workflow |
| C4.5 | Credit notes for reversals | Reversal/refund flow that issues a compliant credit note |
| C4.6 | Offline resilience | Queue invoices when eTIMS is unreachable; transmit and reconcile on recovery |

### C5. Clinical & professional practice

| # | Requirement | Build implication |
|---|---|---|
| C5.1 | Only licensed practitioners prescribe, diagnose and sign | Licence number per user, role-gated actions, cadre-aware permissions |
| C5.2 | Controlled substances register | Separate controlled-drug ledger, dual sign-off, tamper-evident |
| C5.3 | Only PPB-registered products dispensed | Product catalogue keyed to PPB registration |
| C5.4 | Batch, expiry and recall traceability | Batch-level stock, expiry blocking, recall sweep by batch |
| C5.5 | Medical records retention | Configurable retention policy; no hard delete of clinical records — reversal by amendment with audit |
| C5.6 | Amendments never overwrite | Append-only clinical record; every version retained and attributed |

### C6. Reporting to MOH / KHIS

| # | Requirement | Build implication |
|---|---|---|
| C6.1 | MOH facility returns (e.g. MOH 705A/705B outpatient, MOH 717 workload) | Generated from transactions, not re-keyed |
| C6.2 | Programme reporting — HIV, TB, malaria, immunisation, maternal health | Programme registers with the right data elements |
| C6.3 | Notifiable disease reporting | Flag and report path |
| C6.4 | KHIS/DHIS2 submission | Automated push with reconciliation report |
| C6.5 | Facility identified by KMHFL code | KMHFL code mandatory in facility setup |

---

## 3. Compliance as a product surface

Do not hide compliance in a policy PDF. Make it visible and sellable:

- **Compliance Dashboard** — a single screen showing DHA certification status, SHA connection health, eTIMS transmission backlog, claims within the 7-day window, ODPC registration expiry, and open data-protection tasks.
- **Compliance Changelog** — every regulatory change we ship, dated. This is the answer to "what am I paying the subscription for?"
- **Audit Pack Export** — one button produces the evidence bundle an inspector or auditor asks for.

---

## 4. Compliance risk register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| DHA certification takes longer than planned | Cannot sell at all | High | Start vendor registration **now**, in parallel with build; design to the standard, not to the certificate |
| SHA API specification changes mid-build | Rework | High | Isolate all payer logic behind an anti-corruption layer; version the adapter |
| SHA platform outage (precedent: March 2026) | Facility cannot verify or preauth | Medium | Offline queue + documented emergency/OTP exception path + reconciliation |
| Data breach | Regulatory penalty, reputational ruin | Low/severe | Encryption, least privilege, audit, pen test before launch, incident plan |
| Facility not ODPC-registered | Facility is non-compliant, blames the system | High | Make ODPC registration a gated onboarding step we assist with |
| Practitioner licence lapses | Invalid claims | Medium | Licence expiry tracking with pre-expiry warnings |

---

## Sources

- [Digital Health Act 2023 — Kenya Law](https://new.kenyalaw.org/akn/ke/act/2023/15/eng@2023-11-24)
- [DHA official certification portal for digital health systems](https://certification.dha.go.ke/)
- [What Kenya's Digital Health Act portends for data governance — CIPESA policy brief](https://cipesa.org/download/Policy_Brief_-_Kenyas_Digital_Health_Act.pdf)
- [The Digital Health Act in Kenya: what every clinician, lawyer and tech provider must know — AMG Advocates](https://www.amgadvocates.com/post/the-digital-health-act-in-kenya-critical-details)
- [Patient empowerment, innovation, interoperability and privacy — KELIN Kenya](https://www.kelinkenya.org/patient-empowerment-innovation-interoperability-and-privacy-the-core-of-the-digital-health-bill-2023/)
- [SHA makes accredited HMIS mandatory — Kenyans.co.ke](https://www.kenyans.co.ke/news/124812-sha-makes-accredited-hmis-mandatory-all-healthcare-providers)
- [TaifaCare — KenyaEMR release notes (emergency/ECCIF, OTP, biometrics behaviour)](https://github.com/Palladium-hub/kenyaemr-releases/releases/tag/19.4.4)
- [Why SHA claims get rejected in Kenya — MyCyber](https://mycyber.co.ke/why-sha-claims-get-rejected-in-kenya-8-reasons-fixes/)
- [ODPC frequently asked questions](https://www.odpc.go.ke/faqs/)
- [Registration as a data controller and data processor in Kenya — Njaga Advocates](https://njagaadvocates.com/registration-as-a-data-controller-and-data-processor-in-kenya-with-the-odpc/)
- [KRA — what is eTIMS](https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/what-is-etims)
- [KRA eTIMS compliance for hospitals & clinics in Kenya](https://www.hanmak.co.ke/etims-compliance-kenyan-healthcare/)
- [eTIMS for medical services — the invoice versus revenue recognition dilemma](https://simonkigondu.co.ke/etims-for-medical-services-the-invoice-versus-revenue-recognition-dilema/)

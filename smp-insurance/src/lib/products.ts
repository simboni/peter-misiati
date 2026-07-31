import type { ProductIconName } from "@/components/icons";

/**
 * Product catalogue — the single source of truth for every product page,
 * the products hub, the quote form's product selector, nav menus, and the
 * per-product structured data (Service + FAQPage JSON-LD).
 *
 * Copy is grounded in current Kenyan market practice: TPO/TPFT/Comprehensive
 * motor tiers, DMVIC digital certificates, SHA/SHIF (which replaced NHIF in
 * Oct 2024), WIBA 2007 obligations, IPF instalment financing, and the
 * police-abstract claims journey. Indicative prices are market ranges —
 * confirm current rates with the underwriters before publishing.
 */

export type ProductFaq = { q: string; a: string };

export type Product = {
  slug: string;
  name: string;
  navLabel: string;
  icon: ProductIconName;
  category: "Personal" | "Business";
  tagline: string;
  fromNote?: string;
  summary: string;
  covered: string[];
  notCovered: string[];
  options?: { title: string; note?: string; tiers: { name: string; points: string[] }[] };
  documents: string[];
  claimSteps: string[];
  faqs: ProductFaq[];
};

export const products: Product[] = [
  {
    slug: "motor",
    name: "Motor Insurance",
    navLabel: "Motor",
    icon: "car",
    category: "Personal",
    tagline: "Private cars, commercial vehicles, PSVs and boda bodas — with your digital certificate (DMVIC) issued the same day.",
    fromNote: "Comprehensive typically 3–7.5% of vehicle value/yr · third-party from a few thousand shillings",
    summary:
      "Motor insurance is a legal requirement on Kenyan roads, but the right cover is about more than the sticker. We compare comprehensive, third-party fire & theft and third-party-only quotes across Kenya's leading underwriters, so you get the strongest cover your budget allows — and when the worst happens, we run the claim for you.",
    covered: [
      "Third-party injury and death (mandatory under the Insurance (Motor Vehicles Third Party Risks) Act)",
      "Third-party property damage",
      "Comprehensive: accidental damage to your own vehicle, fire, theft and flood/special perils",
      "Digital Motor Vehicle Insurance Certificate (DMVIC) — emailed to you, verifiable via *352#",
      "Optional: excess protector, political violence & terrorism, windscreen and radio limits, courtesy car, towing & recovery",
      "PSV covers with Passenger Legal Liability for matatus, taxis and tour vehicles",
    ],
    notCovered: [
      "Driving without a valid licence, or under the influence of alcohol or drugs",
      "Mechanical or electrical breakdown, and wear and tear",
      "Use outside the policy's purpose (e.g. carrying paying passengers on a private policy)",
      "Unroadworthy vehicles, and deliberate damage",
      "Loss when the vehicle is left unlocked or keys left inside (most theft covers)",
    ],
    options: {
      title: "Which motor cover level do you need?",
      note: "We'll quote all three so you can compare real premiums side by side.",
      tiers: [
        {
          name: "Third Party Only (TPO)",
          points: [
            "The legal minimum to drive in Kenya",
            "Covers injury, death and property damage you cause to others",
            "No cover for your own vehicle",
            "Cheapest option — best for low-value vehicles",
          ],
        },
        {
          name: "Third Party, Fire & Theft (TPFT)",
          points: [
            "Everything in TPO",
            "Plus fire damage to your own vehicle",
            "Plus theft of your vehicle",
            "A sensible middle ground",
          ],
        },
        {
          name: "Comprehensive",
          points: [
            "Everything in TPFT",
            "Plus accidental damage to your own vehicle",
            "Floods, storms and special perils",
            "Typically 3–7.5% of vehicle value per year — required by banks for financed cars",
          ],
        },
      ],
    },
    documents: [
      "Copy of your National ID or passport",
      "KRA PIN certificate",
      "Copy of the vehicle logbook (or import documents for new imports)",
      "Valuation report for comprehensive cover (we arrange this with approved valuers)",
      "Driving licence copy",
    ],
    claimSteps: [
      "Check that everyone is safe, then call the police — get the OB number and, later, the police abstract (required for accident and theft claims).",
      "Call or WhatsApp us immediately — within 24–48 hours at the latest. We notify the underwriter for you.",
      "Photograph the scene and the damage. Do not admit liability at the roadside.",
      "Send us the claim form (we help you fill it), police abstract, driving licence, ID and logbook copies.",
      "The underwriter appoints an assessor; we follow up so this happens fast.",
      "Repairs are authorised at an approved garage — we push for quick authorisation and keep you updated to release and collection.",
    ],
    faqs: [
      {
        q: "Is third-party insurance enough?",
        a: "It keeps you legal, but it pays nothing for your own car. If your vehicle would be expensive to repair or replace, comprehensive cover is usually worth it — and it's mandatory for bank-financed vehicles. We'll quote both so you can compare.",
      },
      {
        q: "How fast do I get my certificate?",
        a: "Motor certificates are now digital (DMVIC). Once your premium is paid, the certificate is issued electronically — usually the same day — and you can verify it any time by dialling *352#.",
      },
      {
        q: "Can I pay my premium in instalments?",
        a: "Yes. Through Insurance Premium Financing (IPF), a financier pays the full annual premium upfront and you repay monthly, typically over 4–10 months. Ask us for an IPF quote alongside your cover quote.",
      },
      {
        q: "Do you cover matatus, taxis and boda bodas?",
        a: "Yes — PSV covers including Passenger Legal Liability for matatus and taxis, plus third-party and comprehensive options for boda bodas and tuk tuks.",
      },
      {
        q: "What is an excess and should I protect it?",
        a: "The excess is the first portion of any claim you pay yourself. An excess protector add-on removes it for a small extra premium, so the underwriter pays the full repair bill.",
      },
    ],
  },
  {
    slug: "medical",
    name: "Medical & Health Insurance",
    navLabel: "Medical",
    icon: "health",
    category: "Personal",
    tagline: "Inpatient, outpatient, maternity and dental covers for individuals, families and companies — built to top up your SHA cover.",
    fromNote: "Individual and family plans with inpatient limits from KES 500,000 to over KES 5M",
    summary:
      "SHIF gives every Kenyan a base layer of cover — private medical insurance is what gets you into the hospital of your choice, with higher limits, outpatient care and no queues. We compare plans from Kenya's top medical underwriters and help you pick limits that match your family or team, not just the cheapest premium.",
    covered: [
      "Inpatient: hospital admission, surgery, ICU/HDU, doctors' fees and ward charges up to your limit",
      "Outpatient (optional): consultations, diagnostics, prescriptions",
      "Maternity (optional, usually after a waiting period)",
      "Dental and optical riders",
      "Last-expense (funeral) benefit riders paid within 48–72 hours",
      "Corporate schemes with per-employee or family-shared limits",
    ],
    notCovered: [
      "Pre-existing and chronic conditions during initial waiting periods (disclosed conditions are covered after)",
      "Cosmetic and elective procedures",
      "Self-inflicted injuries and non-prescribed treatments",
      "Conditions arising before cover starts and undisclosed conditions",
      "Some plans exclude specific hospitals — we flag this before you buy",
    ],
    options: {
      title: "Ways to buy medical cover",
      tiers: [
        {
          name: "Individual & family",
          points: [
            "Choose your inpatient limit (KES 500K–5M+)",
            "Add outpatient, maternity, dental, optical",
            "Family limits shared or per person",
            "Premiums depend on ages and limits",
          ],
        },
        {
          name: "Corporate / SME group",
          points: [
            "Cover from as few as 5–10 staff",
            "Better rates than individual plans",
            "A real staff-retention benefit",
            "We manage member additions and deletions",
          ],
        },
        {
          name: "Top-up to SHA/SHIF",
          points: [
            "SHIF registration is mandatory for all Kenyans",
            "Private cover adds choice of hospital",
            "Higher limits and faster access",
            "We structure covers to complement, not duplicate",
          ],
        },
      ],
    },
    documents: [
      "National ID or passport copies for all adults on the cover",
      "Birth certificates or notifications for children",
      "KRA PIN (principal member)",
      "Filled medical questionnaire (we walk you through it)",
      "For corporate schemes: staff list with dates of birth",
    ],
    claimSteps: [
      "For planned admissions, call us first — most covers require pre-authorisation, which we obtain from the underwriter.",
      "In an emergency, go straight to hospital and present your medical card; have the hospital or a family member call us as soon as possible.",
      "At panel hospitals, treatment is cashless — the underwriter settles directly.",
      "If you pay out of pocket (non-panel or reimbursement plans), keep all receipts and reports and send them to us within the policy window.",
      "We follow up reimbursements until the money is in your account.",
    ],
    faqs: [
      {
        q: "I already contribute to SHIF. Do I still need private cover?",
        a: "SHIF (under the Social Health Authority) is mandatory and gives you a public baseline. Private medical cover adds access to private hospitals, higher inpatient limits, outpatient care, dental and optical — and much faster service. Most of our clients hold both.",
      },
      {
        q: "Are pre-existing conditions covered?",
        a: "Declared pre-existing and chronic conditions are typically covered after a waiting period (often 1 year, varying by underwriter). Never hide a condition — undisclosed conditions are the most common reason medical claims are declined.",
      },
      {
        q: "What is a panel hospital?",
        a: "Each underwriter has a list of approved hospitals where your treatment is cashless — you show your card and the insurer pays directly. We share the panel list before you buy so you can check your preferred hospitals are on it.",
      },
      {
        q: "How is the premium calculated?",
        a: "Mainly by the ages of the people covered, the inpatient limit you choose, and the benefits you add (outpatient, maternity, dental). We'll model 2–3 options so you can see exactly what each shilling buys.",
      },
    ],
  },
  {
    slug: "life",
    name: "Life Assurance & Education Plans",
    navLabel: "Life & Education",
    icon: "umbrella",
    category: "Personal",
    tagline: "Protect your family's income and lock in your children's school fees — term life, whole life, endowment and education policies.",
    summary:
      "Life assurance answers one question: if your income stopped tomorrow, would your family manage? From pure-protection term covers to endowment and education plans that pay out in time for school fees, we compare Kenya's leading life underwriters and match a policy to your stage of life and budget.",
    covered: [
      "Term life: a lump sum to your family if you pass away within the term — the most cover per shilling",
      "Whole life: guaranteed payout whenever death occurs",
      "Endowment: disciplined saving plus life cover, with a maturity payout",
      "Education plans: maturities timed to secondary school and university fees",
      "Mortgage protection required by banks for home loans",
      "Riders: critical illness, accidental death, waiver of premium, last expense",
    ],
    notCovered: [
      "Suicide within the first policy years (typically 1–2, per policy terms)",
      "Non-disclosure of material health facts at application",
      "Some hazardous activities unless declared and rated",
      "Lapsed policies — we send renewal reminders so yours never lapses silently",
    ],
    options: {
      title: "Which life policy fits your goal?",
      tiers: [
        {
          name: "Term life",
          points: [
            "Pure protection, no savings element",
            "Highest cover for the lowest premium",
            "Ideal for young families and loan protection",
            "Choose a term matching your responsibilities",
          ],
        },
        {
          name: "Endowment / education",
          points: [
            "Savings + cover in one policy",
            "Education plans pay in tranches for fees",
            "Partial maturities along the way",
            "Kenya's most popular life product",
          ],
        },
        {
          name: "Whole life",
          points: [
            "Cover for your entire lifetime",
            "Builds cash value over time",
            "Estate planning and last-expense uses",
            "Premiums can be limited-pay",
          ],
        },
      ],
    },
    documents: [
      "National ID or passport and KRA PIN",
      "Filled proposal form (we complete it together)",
      "Medical examination for higher sums assured (underwriter-arranged, free to you)",
      "Beneficiary details",
    ],
    claimSteps: [
      "Call or WhatsApp us — we'll tell you exactly what the underwriter needs and handle the process with your family.",
      "Provide the death certificate (or burial permit initially), the policy document and the claimant's ID.",
      "We submit the claim and follow up until payment; last-expense riders typically pay within 48–72 hours.",
      "For maturity claims, we alert you before maturity date and process the payout paperwork for you.",
    ],
    faqs: [
      {
        q: "How much life cover do I need?",
        a: "A common rule of thumb is 5–10 times your annual income, adjusted for debts, school fees ahead, and what your family already has. We'll do this arithmetic with you honestly — over-insuring wastes premium, under-insuring defeats the purpose.",
      },
      {
        q: "What happens if I stop paying premiums?",
        a: "Term policies lapse after the grace period. Endowment and whole-life policies that have run a few years acquire a surrender value, or can be converted to paid-up status for reduced cover. Talk to us before stopping — there is almost always a better option than a silent lapse.",
      },
      {
        q: "Are payouts taxed?",
        a: "Life assurance payouts to beneficiaries are generally tax-free in Kenya, and life premiums attract a 15% insurance relief on premiums up to set limits. We'll show you how to claim the relief through your payroll or tax return.",
      },
    ],
  },
  {
    slug: "personal-accident",
    name: "Personal Accident Cover",
    navLabel: "Personal Accident",
    icon: "shield",
    category: "Personal",
    tagline: "Cash benefits if an accident leaves you injured, disabled or worse — for individuals, families and groups.",
    summary:
      "Accidents don't check your calendar. Personal Accident (PA) cover pays fixed cash benefits — not just medical bills — if an accident causes death, permanent disability, or keeps you out of work. It's one of the cheapest covers in the market, and one of the most underrated.",
    covered: [
      "Accidental death: a lump sum to your beneficiaries",
      "Permanent total or partial disability, per a defined scale",
      "Accident-related medical expenses up to your limit",
      "Weekly benefit while you can't work (temporary total disablement)",
      "Optional funeral expense benefit",
      "Group PA for teams, schools, saccos and chamas",
    ],
    notCovered: [
      "Illness and natural causes (that's medical/life cover)",
      "Self-inflicted injury, and injuries while intoxicated",
      "Professional hazardous sports unless declared",
      "War and active participation in riots",
    ],
    documents: [
      "National ID or passport and KRA PIN",
      "Short proposal form with occupation details (occupation drives the rate)",
      "Beneficiary details",
    ],
    claimSteps: [
      "Seek treatment first; keep every receipt and medical report.",
      "Notify us within the policy window — a WhatsApp message starts the clock.",
      "Provide the claim form, medical reports, and a police abstract for road or assault incidents.",
      "We submit, follow up, and chase the underwriter until your benefit is paid.",
    ],
    faqs: [
      {
        q: "I have medical cover — why do I need PA?",
        a: "Medical cover pays the hospital. PA pays you — fixed cash for disability or lost working time, on top of any medical cover. For breadwinners in hands-on work, it's the difference between recovering and going broke while recovering.",
      },
      {
        q: "Does my job affect the premium?",
        a: "Yes. Occupations are rated by risk class — an accountant pays less than a welder for the same benefits. Always state your real occupation; a wrong class can void a claim.",
      },
    ],
  },
  {
    slug: "wiba",
    name: "WIBA — Work Injury Benefits",
    navLabel: "WIBA",
    icon: "hardhat",
    category: "Business",
    tagline: "Every Kenyan employer's legal obligation under the Work Injury Benefits Act, 2007 — covered properly, priced by headcount.",
    summary:
      "If you employ anyone — from an office team to a house help, guard or driver — the Work Injury Benefits Act (WIBA) 2007 makes you personally liable for their work-related injury, illness or death. A WIBA policy transfers that liability to an underwriter for a modest premium per employee. We arrange compliant covers for SMEs, contractors, schools, farms and households.",
    covered: [
      "Death benefit: up to 96 months' earnings per the Act",
      "Permanent total or partial disablement per the Act's schedule",
      "Temporary disablement: earnings while an employee cannot work (up to 12 months)",
      "Accident-related medical expenses per employee",
      "Funeral expenses benefit",
      "Optional enhancements: Group Personal Accident and Employer's Liability on top",
    ],
    notCovered: [
      "Injuries outside the course of employment",
      "Self-inflicted injury or injury while intoxicated",
      "Employees not declared on the schedule — keep your staff list with us up to date",
    ],
    documents: [
      "Company/business registration (or employer's ID for domestic staff)",
      "KRA PIN",
      "Staff list with job titles and monthly earnings",
    ],
    claimSteps: [
      "Get the injured employee treated immediately.",
      "Report to us within 24–48 hours; we notify the underwriter and share the DOSH incident forms required by law.",
      "Submit medical reports and the employee's earnings details.",
      "Assessment of disability where applicable, then benefit payment — we push every step.",
    ],
    faqs: [
      {
        q: "Is WIBA really mandatory?",
        a: "Yes. The Work Injury Benefits Act 2007 obliges every employer to insure employees against work-related injury and death. Without a policy, the liability — up to 96 months of an employee's pay — falls on you personally, and labour officers can prosecute non-compliance.",
      },
      {
        q: "Does WIBA cover my house help or watchman?",
        a: "Domestic workers are employees under the Act. A domestic WIBA policy (often bundled inside a Domestic Package) covers house helps, gardeners, guards and drivers at very low premiums.",
      },
      {
        q: "What's the difference between WIBA and Group Personal Accident?",
        a: "WIBA covers your statutory liability for work-related injuries, on the Act's benefit scale. GPA is a welfare benefit covering employees 24/7, on and off duty. Many employers buy both — we'll price the combination.",
      },
    ],
  },
  {
    slug: "business",
    name: "Business & SME Insurance",
    navLabel: "Business / SME",
    icon: "briefcase",
    category: "Business",
    tagline: "One package for your premises, stock, money, staff and liability — fire, burglary, WIBA, goods in transit and more.",
    summary:
      "Your business is probably your biggest asset — and most Kenyan SMEs are one fire or burglary away from starting over. A combined business package bundles the covers a trading business actually needs into one policy with one renewal date, at a better price than buying them separately. We tailor the sections to your business, whether you run a shop, clinic, school, workshop, restaurant or office.",
    covered: [
      "Fire & allied perils: premises, stock and equipment against fire, lightning, explosion, floods and riots",
      "Burglary: theft involving forcible entry or exit",
      "Money: cash in transit, in safe, and on premises",
      "All-risks on portable items (laptops, tools, equipment)",
      "Public liability: injury to customers and third parties on your premises",
      "WIBA and Group Personal Accident for your staff",
      "Business interruption: lost gross profit while you rebuild",
      "Specialist add-ons: professional indemnity, goods in transit, contractors all risks, marine cargo for importers",
    ],
    notCovered: [
      "Unexplained stock shortages (theft must involve forcible entry)",
      "Wear, tear and gradual deterioration",
      "Uninsured perils not selected in your package — we review your sections annually so nothing important is left out",
      "Fraud by directors/owners",
    ],
    documents: [
      "Business registration certificate and KRA PIN",
      "Description of premises, and values of stock, equipment and contents",
      "Staff list (for WIBA/GPA sections)",
      "Previous policy or claims history if any",
    ],
    claimSteps: [
      "Secure the premises and call the police for burglary or malicious damage — obtain an abstract.",
      "Notify us immediately; for fire, the fire brigade report will also be needed.",
      "Document everything: photos, stock records, purchase invoices.",
      "The underwriter appoints an assessor; we prepare your claim file so assessment is fast and complete.",
      "Settlement — repair, replacement or cash — with us following up throughout.",
    ],
    faqs: [
      {
        q: "I import goods. Must I insure them locally?",
        a: "Yes. Kenyan law requires imports to be insured with locally licensed underwriters, with digital marine cargo cover linked to KRA customs clearance — enforcement is now digital. We arrange compliant marine cargo cover fast, per shipment or on open cover.",
      },
      {
        q: "What is business interruption cover?",
        a: "After a fire, rent and salaries don't pause while you rebuild. Business interruption pays your lost gross profit and continuing costs for the months it takes to get trading again. It's the section most SMEs skip — and most regret skipping.",
      },
      {
        q: "How is the premium set?",
        a: "By the values you declare per section (buildings, stock, money, equipment) and your trade. Under-declaring values leads to 'average' being applied at claim time — you'd be paid proportionately less. We help you set values honestly and competitively.",
      },
    ],
  },
  {
    slug: "home",
    name: "Domestic Package (Home Insurance)",
    navLabel: "Home",
    icon: "home",
    category: "Personal",
    tagline: "Your house, its contents, your valuables and your domestic staff — one policy for everything under your roof.",
    summary:
      "A Domestic Package wraps the covers a Kenyan home needs into one policy: the building against fire and perils, contents against burglary and damage, portable valuables anywhere in the country, your liability as an owner or occupier, and WIBA for your domestic staff. If you own or rent a home with anything worth protecting, this is the quiet essential.",
    covered: [
      "Buildings: fire, lightning, explosion, storms, floods, earthquakes (owners)",
      "Contents: furniture, electronics and household goods against fire, burglary and water damage",
      "All-risks: jewellery, phones, laptops and cameras — even outside the home",
      "Owner's/occupier's liability to third parties",
      "Domestic staff WIBA: house helps, guards, gardeners",
      "Alternative accommodation if your home becomes uninhabitable",
    ],
    notCovered: [
      "Wear, tear and gradual deterioration",
      "Theft without forcible entry (contents section)",
      "Homes left unoccupied beyond the policy's stated period",
      "Business equipment (that belongs on a business policy — talk to us)",
    ],
    documents: [
      "National ID and KRA PIN",
      "Property value (buildings) and an itemised contents list with values",
      "Valuation for high-value items (jewellery, art)",
    ],
    claimSteps: [
      "For burglary, call the police and get an abstract; for fire, the brigade report.",
      "Notify us immediately by phone or WhatsApp.",
      "Send photos and your contents list — this is why we ask for it upfront.",
      "Assessment, then repair, replacement or cash settlement — we follow up to the end.",
    ],
    faqs: [
      {
        q: "I rent — is this still for me?",
        a: "Yes. Tenants insure contents, all-risks valuables, liability and domestic staff; the building section is for owners. Premiums for a contents-only package are surprisingly low.",
      },
      {
        q: "Is my phone covered outside the house?",
        a: "Under the all-risks section, listed portable items are covered anywhere in Kenya (and often worldwide) — including accidental damage and theft. Items must be specified with values.",
      },
    ],
  },
  {
    slug: "travel",
    name: "Travel Insurance",
    navLabel: "Travel",
    icon: "plane",
    category: "Personal",
    tagline: "Schengen-compliant medical cover, evacuation, lost baggage and flight delays — buy today, fly tomorrow.",
    summary:
      "Travel insurance is the cheapest ticket-saver you'll ever buy: emergency treatment abroad can cost more than the entire trip, and Schengen embassies won't issue a visa without proof of at least €30,000 medical cover. We issue compliant travel certificates fast — often same-day — for holidays, business trips, studies and Hajj/Umrah.",
    covered: [
      "Emergency medical treatment and hospitalisation abroad",
      "Emergency evacuation and repatriation",
      "Schengen visa-compliant certificates (€30,000+ medical cover)",
      "Lost, stolen or delayed baggage",
      "Flight delays and cancellations",
      "Personal liability while travelling",
      "Single-trip, annual multi-trip, student and pilgrimage plans",
    ],
    notCovered: [
      "Pre-existing conditions unless declared and accepted",
      "Travel against medical advice",
      "High-risk activities unless the plan includes them (check before you ski or dive)",
      "Claims without documentation — keep reports and receipts",
    ],
    documents: [
      "Passport bio page copy",
      "Travel dates and destination countries",
      "That's it — certificates are usually issued the same day",
    ],
    claimSteps: [
      "For medical emergencies abroad, call the assistance number on your certificate (24/7) — treatment is coordinated and guaranteed directly.",
      "For baggage, obtain a Property Irregularity Report (PIR) from the airline before leaving the airport.",
      "For delays, keep boarding passes and airline confirmations.",
      "Send us everything when you're back — we file and follow up the claim.",
    ],
    faqs: [
      {
        q: "How fast can I get a Schengen certificate?",
        a: "Usually the same working day. Send us your passport bio page and travel dates on WhatsApp, pay via M-PESA, and we email your compliant certificate for the visa application.",
      },
      {
        q: "Does it cover COVID-19 or other illness abroad?",
        a: "Most current plans cover emergency treatment of illness contracted while travelling, including infectious disease, within the medical limit. We'll confirm the specific plan wording before you buy.",
      },
    ],
  },
  {
    slug: "agriculture",
    name: "Agriculture Insurance",
    navLabel: "Agriculture",
    icon: "leaf",
    category: "Business",
    tagline: "Crop, livestock and greenhouse covers — including index-based products that pay out on weather data, fast.",
    summary:
      "Farming is Kenya's biggest employer and its most exposed business — one drought, flood or disease outbreak can wipe out a season. Agriculture insurance has matured fast: alongside traditional crop and livestock covers, index-based products now pay automatically when rainfall or yield data crosses a trigger, with payouts required within days. We cover smallholders, commercial farms, and agri-SMEs.",
    covered: [
      "Crop insurance: drought, excess rain, hail, frost, fire, pests and diseases (per policy)",
      "Livestock: death by accident or disease of cattle, dairy herds, poultry and goats (identification required)",
      "Index-based/weather-index covers with data-triggered payouts",
      "Greenhouse structures and crops",
      "Farm structures, machinery and produce in store",
      "Farm workers' WIBA",
    ],
    notCovered: [
      "Unidentifiable livestock (ear tags/microchips are required)",
      "Poor husbandry and unvaccinated herds",
      "Pre-existing disease at cover start",
      "Government-culled animals unless the peril is covered",
    ],
    documents: [
      "National ID and KRA PIN",
      "Farm location and acreage / herd details",
      "Vet certificates for livestock cover",
      "Production records where available",
    ],
    claimSteps: [
      "Report loss immediately — for livestock, before disposal of the carcass, with a vet report.",
      "For crop losses, we arrange field assessment quickly so evidence isn't lost.",
      "Index products pay automatically on the trigger — no assessment needed; regulations require payment within 10 days of trigger.",
      "We handle the paperwork and follow the payout to your M-PESA or bank.",
    ],
    faqs: [
      {
        q: "What is index-based insurance?",
        a: "Instead of assessing your individual farm, the policy pays automatically when an objective index — rainfall measured by satellite/weather stations, or area yields — crosses an agreed trigger. It's cheaper to run, harder to dispute, and Kenya's 2025 index insurance regulations require payouts within 10 days.",
      },
      {
        q: "Can smallholders afford this?",
        a: "Yes — index products are priced for smallholders, and government-supported schemes subsidise livestock and crop covers in many counties. Ask us what's available for your county and crop.",
      },
    ],
  },
  {
    slug: "pensions",
    name: "Pensions & Retirement",
    navLabel: "Pensions",
    icon: "piggy",
    category: "Personal",
    tagline: "Individual pension plans and umbrella schemes — tax-deductible saving up to KES 30,000 a month.",
    summary:
      "NSSF alone will not fund the retirement you're picturing. An Individual Pension Plan (IPP) lets you save flexibly — from modest monthly amounts — with contributions tax-deductible up to KES 30,000 per month, growing under RBA-regulated management. Employers can offer staff retirement benefits through umbrella schemes without the cost of running their own scheme.",
    covered: [
      "Individual Pension Plans: flexible contributions, tax relief up to KES 360,000/year",
      "Umbrella schemes for employers of any size",
      "Preservation and transfer of benefits when you change jobs",
      "Annuities and income drawdown at retirement",
      "Registered under the Retirement Benefits Authority (RBA)",
    ],
    notCovered: [
      "Early access beyond the rules (a portion is accessible on job change; retirement benefits are preserved to protect you)",
      "Guaranteed high returns — we show you real, audited fund performance instead of promises",
    ],
    documents: [
      "National ID and KRA PIN",
      "Chosen monthly/annual contribution",
      "For umbrella schemes: staff list and employer registration",
    ],
    claimSteps: [
      "At retirement (or emigration/permitted access), we help you file with the scheme administrator.",
      "Choose between a lump sum portion, annuity, or income drawdown — we explain the tax outcome of each.",
      "Benefits are paid to your bank; we track the process end to end.",
    ],
    faqs: [
      {
        q: "How is this different from NSSF?",
        a: "NSSF is the mandatory national baseline. An IPP is voluntary, on top — you choose the amount, get tax relief on contributions up to KES 30,000/month, and your money is professionally managed under RBA regulation. Most professionals need both to retire comfortably.",
      },
      {
        q: "What if I change employers?",
        a: "Your pension is yours. Benefits transfer to your new employer's scheme or continue in your personal plan — nothing is lost when you move.",
      },
    ],
  },
];

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export const personalProducts = products.filter((p) => p.category === "Personal");
export const businessProducts = products.filter((p) => p.category === "Business");

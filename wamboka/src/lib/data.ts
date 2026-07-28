/* ---------------------------------------------------------------------------
   THE WAMBOKA RECORD — single source of truth.

   Every entry on the site renders from this file. Each fact carries:
   - sources: publicly checkable references (news, Parliament, NG-CDF Board)
   - status:  "verified"  → confirmed in official records
              "reported"  → carried by credible press, official record pending
              "pending"   → awaiting publication of the official figure

   Nothing is shown to a voter without a status and a source. That is the
   entire point of this site.
--------------------------------------------------------------------------- */

export type Verification = "verified" | "reported" | "pending";

export type Source = {
  name: string;
  url: string;
  date?: string; // ISO or human date of the source item
};

export type Fact = {
  claim: string;
  detail?: string;
  date: string; // display date, e.g. "May 2024"
  status: Verification;
  sources: Source[];
};

export type TimelineEvent = Fact & {
  year: string;
  kind: "election" | "oversight" | "constituency" | "integrity" | "money";
};

/* ------------------------------------------------------------------ site */

export const site = {
  domain: "wamboka-record.example.com", // set the real domain before launch
  title: "Jack Wanami Wamboka — The Record",
  description:
    "The full, sourced track record of Hon. Jack Wanami Wamboka, MP for Bumula: oversight work in Parliament, the NG-CDF money trail, constituency delivery — and the hard parts, in the open.",
  updated: "28 July 2026",
};

/* --------------------------------------------------------------- profile */

export const profile = {
  name: "Jack Wanami Wamboka",
  officialName: "Hon. Wamboka Wanami Jack Nelson",
  role: "Member of Parliament, Bumula Constituency",
  county: "Bungoma County",
  party: "Democratic Action Party of Kenya (DAP-K)",
  coalition: "Azimio la Umoja",
  firstElected: "August 2022",
  term: "13th Parliament (2022–2027)",
  seat: "Seeking re-election, 2027",
  tagline: "The watchdog who shows his books.",
  positioning:
    "One of the loudest oversight voices in the 13th Parliament — the MP who moved the impeachment of a sitting Cabinet Secretary over the fake-fertiliser scandal, chaired the committee that put universities' audit queries under the microscope, and fought publicly for NG-CDF money to reach Bumula's students on time.",
  interests: ["Environment", "Budget", "Transport & Infrastructure"],
  honours: [
    {
      claim: "Honorary Warden — Kenya Wildlife Service",
      status: "reported" as Verification,
      sources: [
        {
          name: "Mzalendo — MP profile",
          url: "https://mzalendo.com/parliament/politician/wamboka-jack/",
        },
      ],
    },
  ],
  officialProfile:
    "https://www.parliament.go.ke/the-national-assembly/hon-wamboka-wanami-jack-nelson",
};

/* ------------------------------------------------- headline (hero) stats */

export const heroStats: (Fact & { figure: string; label: string })[] = [
  {
    figure: "110",
    label: "MPs signed his motion to impeach CS Linturi",
    claim: "Impeachment motion backed by 110 legislators' signatures",
    date: "May 2024",
    status: "verified",
    sources: [
      {
        name: "Daily Nation",
        url: "https://nation.africa/kenya/news/-ruto-s-tough-choices-in-linturi-fake-fertiliser-impeachment-bid-4620792",
        date: "May 2024",
      },
    ],
  },
  {
    figure: "149–36",
    label: "House vote endorsing the Linturi impeachment inquiry",
    claim:
      "The National Assembly voted 149 to 36 to establish a select committee on the impeachment charges",
    date: "May 2024",
    status: "verified",
    sources: [
      {
        name: "The Standard",
        url: "https://www.standardmedia.co.ke/politics/article/2001494687/linturi-ouster-motion-officially-kicks-off",
        date: "May 2024",
      },
    ],
  },
  {
    figure: "KSh 197M",
    label: "Bumula's NG-CDF allocation under the 2025 formula",
    claim:
      "Bumula placed in the second-highest allocation tier nationally — KSh 197 million",
    date: "January 2025",
    status: "reported",
    sources: [
      {
        name: "The Star",
        url: "https://www.the-star.co.ke/news/realtime/2025-01-22-mt-kenya-reaps-big-under-latest-ng-cdf-formula",
        date: "22 Jan 2025",
      },
    ],
  },
  {
    figure: "Top 3",
    label: "Bumula's rank in Bungoma education standings",
    claim: "Bumula rose to the top 3 in Bungoma County education rankings",
    date: "January 2026",
    status: "reported",
    sources: [
      {
        name: "Horizon News",
        url: "https://horizonnews.co.ke/2026/01/24/bumula-rises-to-top-3-in-bungoma-education-rankings-wamboka/",
        date: "24 Jan 2026",
      },
    ],
  },
];

/* ---------------------------------------------------- oversight casework */

export const oversightCases: {
  slug: string;
  title: string;
  kicker: string;
  summary: string;
  outcome: string;
  outcomeTone: "win" | "mixed" | "open";
  facts: Fact[];
}[] = [
  {
    slug: "linturi-impeachment",
    title: "The fake-fertiliser impeachment",
    kicker: "Holding a Cabinet Secretary to account",
    summary:
      "After farmers nationwide were sold substandard fertiliser under a state subsidy programme, Wamboka moved the impeachment of Agriculture CS Mithika Linturi — accusing him of gross violation of the Constitution over the National Cereals and Produce Board's procurement and distribution of fake fertiliser.",
    outcome:
      "The House endorsed the inquiry 149–36. An 11-member select committee cleared the CS on a 7–4 party-line vote — every Kenya Kwanza member voted to save him; the Azimio members voted to uphold the charges. Wamboka lost the verdict but forced the scandal onto the national record — and Linturi left the Cabinet in the July 2024 purge.",
    outcomeTone: "mixed",
    facts: [
      {
        claim: "Motion filed with the signatures of 110 MPs",
        detail:
          "Grounds: gross violation of the Constitution, serious reasons to believe a crime was committed under national law, and gross misconduct.",
        date: "April–May 2024",
        status: "verified",
        sources: [
          {
            name: "Daily Nation — Ruto's tough choices in Linturi impeachment bid",
            url: "https://nation.africa/kenya/news/-ruto-s-tough-choices-in-linturi-fake-fertiliser-impeachment-bid-4620792",
          },
        ],
      },
      {
        claim: "National Assembly voted 149–36 to establish the select committee",
        date: "May 2024",
        status: "verified",
        sources: [
          {
            name: "The Standard — Linturi ouster motion officially kicks off",
            url: "https://www.standardmedia.co.ke/politics/article/2001494687/linturi-ouster-motion-officially-kicks-off",
          },
        ],
      },
      {
        claim:
          "Select committee cleared Linturi 7–4 on a party-line split; Wamboka publicly questioned the verdict's impartiality",
        date: "May 2024",
        status: "verified",
        sources: [
          {
            name: "Daily Nation — Committee saves Linturi's job",
            url: "https://nation.africa/kenya/news/committee-saves-linturi-s-job-in-scandal-over-fake-fertiliser-4621248",
          },
          {
            name: "Capital News — Wamboka casts aspersions on impartiality of verdict",
            url: "https://www.capitalfm.co.ke/news/2024/05/linturi-to-know-fate-on-monday-as-wamboka-casts-aspersions-on-impartiality-of-verdict/",
          },
        ],
      },
      {
        claim:
          "Wamboka reported threats to his life during the impeachment push",
        date: "May 2024",
        status: "reported",
        sources: [
          {
            name: "Citizen Digital — MP claims life in danger",
            url: "https://citizen.digital/article/mp-claims-life-in-danger-amidst-push-to-impeach-agriculture-cs-linturi-n341134",
          },
        ],
      },
    ],
  },
  {
    slug: "pic-governance-education",
    title: "Chairing the audit of universities & education agencies",
    kicker: "Public Investments Committee — Governance & Education",
    summary:
      "As chair of PIC (Governance & Education), Wamboka led the probe of public universities, TVETs and education agencies over financial malpractice flagged by the Auditor-General — backdating the inquiry to FY 2019/20 to get to the root of pending bills and audit queries.",
    outcome:
      "The committee pushed institutions on procurement discipline, inclusion of persons with disabilities, and accountability for public funds. Wamboka chaired the committee until his suspension in April 2026 — see the Integrity File for the full, unedited chronology.",
    outcomeTone: "open",
    facts: [
      {
        claim:
          "Launched a probe of universities, TVETs and technical institutes over Auditor-General findings, backdated to FY 2019/20",
        date: "2023–2026",
        status: "verified",
        sources: [
          {
            name: "KBC — PIC goes after institutions of higher learning",
            url: "https://www.kbc.co.ke/pic-goes-after-institutions-of-higher-learning/",
          },
        ],
      },
      {
        claim:
          "Committee sessions flagged funding gaps and governance challenges in universities and pressed education agencies on audit gaps",
        date: "March 2026",
        status: "verified",
        sources: [
          {
            name: "The Standard — MPs flag funding gaps in universities",
            url: "https://www.standardmedia.co.ke/business/education/article/2001542930/mps-flag-funding-gaps-governance-challenges-in-universities",
          },
          {
            name: "The Star — PIC probes audit gaps in education agencies",
            url: "https://www.the-star.co.ke/news/2026-03-04-mps-demand-accountability-as-pic-probes-audit-gaps-in-education-agencies",
          },
        ],
      },
    ],
  },
  {
    slug: "ngcdf-disbursement-fight",
    title: "The fight to get NG-CDF money released",
    kicker: "Taking on the National Treasury",
    summary:
      "When Treasury delayed NG-CDF disbursements while students sat exams without bursaries, Wamboka demanded the National Assembly suspend its own business until the money moved — one of the loudest voices that preceded the phased release of billions to constituencies.",
    outcome:
      "Treasury committed to releasing KSh 5 billion by 5 December 2024 followed by monthly KSh 7 billion tranches; KSh 7 billion was subsequently released amid continued MP pressure. The delays — and who fought them — are on the public record.",
    outcomeTone: "win",
    facts: [
      {
        claim:
          "Demanded suspension of National Assembly business over delayed NG-CDF funds, citing students left without bursaries during examinations",
        date: "December 2024",
        status: "verified",
        sources: [
          {
            name: "Kenyans.co.ke — Bumula MP demands suspension of National Assembly",
            url: "https://www.kenyans.co.ke/news/110832-bumula-mp-demands-suspension-national-assembly-over-delayed-cdf-funds",
          },
        ],
      },
      {
        claim:
          "Government released KSh 7 billion for NG-CDF amid MPs' continued dissatisfaction",
        date: "December 2024 – 2025",
        status: "verified",
        sources: [
          {
            name: "The Standard — Government releases Sh7 billion for CDF",
            url: "https://www.standardmedia.co.ke/national/article/2001516702/government-releases-sh7-billion-for-cdf-amid-mps-dissatisfaction",
          },
        ],
      },
    ],
  },
];

/* -------------------------------------------------------- the money trail */

export const moneyTrail = {
  explainer:
    "The National Government Constituencies Development Fund (NG-CDF) is the main development money an MP influences directly. It is public money — 2.5% of national ordinary revenue, shared across 290 constituencies — and every shilling of it belongs on the public record. This page tracks what Bumula was allocated, what it was spent on, and what the auditors said.",
  allocations: [
    {
      fy: "2025/26",
      amount: "KSh 197,000,000",
      note: "Second-highest tier nationally under the revised population-weighted formula — one of 23 constituencies at this level.",
      status: "reported" as Verification,
      sources: [
        {
          name: "The Star — Mt Kenya reaps big under latest NG-CDF formula",
          url: "https://www.the-star.co.ke/news/realtime/2025-01-22-mt-kenya-reaps-big-under-latest-ng-cdf-formula",
          date: "22 Jan 2025",
        },
      ],
    },
    {
      fy: "2024/25",
      amount: "Awaiting official figure",
      note: "The NG-CDF Board publishes per-constituency allocations; the official Bumula figure will be entered here from ngcdf.go.ke the moment it is transcribed and checked.",
      status: "pending" as Verification,
      sources: [
        {
          name: "NG-CDF Board — Allocations",
          url: "https://ngcdf.go.ke/allocations/",
        },
        {
          name: "NG-CDF Bumula Constituency office",
          url: "https://bumula.ngcdf.go.ke/",
        },
      ],
    },
    {
      fy: "2023/24",
      amount: "Awaiting official figure",
      note: "To be entered from the NG-CDF Board's published allocation schedule and the constituency office record.",
      status: "pending" as Verification,
      sources: [
        {
          name: "NG-CDF Board — Allocations",
          url: "https://ngcdf.go.ke/allocations/",
        },
      ],
    },
    {
      fy: "2022/23",
      amount: "Awaiting official figure",
      note: "First year of the current term. To be entered from the NG-CDF Board's published allocation schedule.",
      status: "pending" as Verification,
      sources: [
        {
          name: "NG-CDF Board — Allocations",
          url: "https://ngcdf.go.ke/allocations/",
        },
      ],
    },
  ],
  spendPriorities: [
    {
      area: "Education — bursaries & scholarships",
      detail:
        "The largest visible NG-CDF line in Bumula: constituency-wide bursary rounds, plus full Form One scholarships for top KCPE performers.",
      status: "verified" as Verification,
      sources: [
        {
          name: "The Star — Bumula top pupils get full Form One scholarships",
          url: "https://www.the-star.co.ke/counties/western/2024-01-16-bumula-top-pupils-in-2023-kcpe-get-full-form-one-scholarships/",
        },
      ],
    },
    {
      area: "Education infrastructure",
      detail:
        "School infrastructure is the NG-CDF's core mandate nationally; Bumula project-level lists (schools, classrooms, amounts) will be published here from the constituency office's project schedule.",
      status: "pending" as Verification,
      sources: [
        {
          name: "NG-CDF Bumula Constituency office",
          url: "https://bumula.ngcdf.go.ke/",
        },
      ],
    },
    {
      area: "Security infrastructure",
      detail:
        "Chiefs' offices, police posts and related national-government functions are NG-CDF-eligible; Bumula's project list will be itemised here once transcribed from official schedules.",
      status: "pending" as Verification,
      sources: [
        {
          name: "NG-CDF Board — Downloads",
          url: "https://ngcdf.go.ke/downloads/",
        },
      ],
    },
  ],
  auditNote:
    "The Office of the Auditor-General audits every constituency's NG-CDF account, typically publishing findings one to three years in arrears. Bumula's audit findings for FY 2022/23 onward will be published on this page, in full, when the reports are released — including any queries. An accountability page that only shows the good news is an advert, not a record.",
  openBooksPledge: [
    "Every financial-year allocation published with its official source",
    "Every project listed with location, budget and completion status",
    "Every Auditor-General query on Bumula NG-CDF published unedited, with the response",
    "Bursary totals per round published after each disbursement",
  ],
};

/* --------------------------------------------------- constituency record */

export const constituency = {
  name: "Bumula Constituency",
  county: "Bungoma County",
  registeredContext:
    "One of Kenya's most populous rural constituencies — placed in the second-highest NG-CDF tier under the 2025 population-weighted formula.",
  delivery: [
    {
      claim: "Bumula rose to the top 3 in Bungoma County education rankings",
      detail:
        "Announced in January 2026 — the constituency's strongest standing in recent years, following sustained bursary and scholarship investment.",
      date: "January 2026",
      status: "reported" as Verification,
      sources: [
        {
          name: "Horizon News — Bumula rises to top 3 in Bungoma education rankings",
          url: "https://horizonnews.co.ke/2026/01/24/bumula-rises-to-top-3-in-bungoma-education-rankings-wamboka/",
        },
      ],
    },
    {
      claim:
        "Full Form One scholarships awarded to 20 top pupils from the 2023 KCPE cohort",
      detail:
        "Underprivileged top performers were supported to join schools of their choice on full scholarships.",
      date: "January 2024",
      status: "verified" as Verification,
      sources: [
        {
          name: "The Star — Bumula top pupils in 2023 KCPE get full Form One scholarships",
          url: "https://www.the-star.co.ke/counties/western/2024-01-16-bumula-top-pupils-in-2023-kcpe-get-full-form-one-scholarships/",
        },
      ],
    },
    {
      claim:
        "Constituency-wide NG-CDF bursary scheme, with targeted special-case support",
      detail:
        "Ongoing bursary rounds through the NG-CDF, with individual interventions on top of the scheme.",
      date: "2023–2026",
      status: "reported" as Verification,
      sources: [
        {
          name: "Tuko — NG-CDF bursary support",
          url: "https://www.tuko.co.ke/",
        },
      ],
    },
    {
      claim:
        "Fought publicly for on-time NG-CDF disbursement when bursary money stalled during national examinations",
      date: "December 2024",
      status: "verified" as Verification,
      sources: [
        {
          name: "Kenyans.co.ke — Bumula MP demands suspension of National Assembly over delayed CDF funds",
          url: "https://www.kenyans.co.ke/news/110832-bumula-mp-demands-suspension-national-assembly-over-delayed-cdf-funds",
        },
      ],
    },
  ],
};

/* --------------------------------------------------------- integrity file */

export const integrityFile = {
  intro:
    "In April 2026, allegations were made against Hon. Wamboka in his capacity as chair of the Public Investments Committee. This page carries the complete chronology — the allegation, the suspension, the committee's findings for him and against him — with sources. Voters deserve the whole record, not a curated one.",
  events: [
    {
      claim:
        "Suspended as PIC (Governance & Education) chair pending investigation of bribery and witness-intimidation allegations",
      detail:
        "The National Assembly suspended the chairmanship and ordered a probe by the Committee of Powers and Privileges after allegations that bribes were solicited as a precondition for favourable consideration in committee proceedings.",
      date: "April 2026",
      status: "verified" as Verification,
      sources: [
        {
          name: "Capital News — Parliament suspends MP Wamboka as PIC chair",
          url: "https://www.capitalfm.co.ke/news/2026/04/parliament-suspends-mp-wamboka-as-pic-chair-over-bribery-intimidation-probe/",
        },
        {
          name: "Citizen Digital — Wamboka suspended as PIC chair",
          url: "https://citizen.digital/article/bumula-mp-wamboka-suspended-as-pic-chair-over-bribery-allegations-n381302",
        },
      ],
    },
    {
      claim:
        "CLEARED of the KSh 3 million bribery allegation — dismissed as hearsay, unsupported by direct corroborative evidence",
      detail:
        "The Committee of Powers and Privileges found the solicitation allegation by the former NCIC chairperson did not meet the requisite standard of proof and dismissed it.",
      date: "June 2026",
      status: "verified" as Verification,
      sources: [
        {
          name: "People Daily — Wamboka cleared as MPs dismiss KSh3m bribery allegations",
          url: "https://www.pressreader.com/kenya/people-daily-epaper/20260611/281509347874592",
        },
        {
          name: "Daily Nation — Parliament clears Bumula MP of bribery claims",
          url: "https://nation.africa/kenya/news/politics/parliament-clears-bumula-mp-of-bribery-claims-but-upholds-his-ouster-5493152",
        },
      ],
    },
    {
      claim:
        "UPHELD: the committee found he engaged in acts of intimidation and hostility toward witnesses, and recommended barring him from committees covering cohesion, governance and audit",
      detail:
        "The finding stands on the record, as does the ouster from the PIC chairmanship. He was subsequently reassigned to the Cohesion Committee. This site does not contest the record; it publishes it.",
      date: "June 2026",
      status: "verified" as Verification,
      sources: [
        {
          name: "Daily Nation — clears bribery claims, upholds ouster",
          url: "https://nation.africa/kenya/news/politics/parliament-clears-bumula-mp-of-bribery-claims-but-upholds-his-ouster-5493152",
        },
        {
          name: "The Standard — MPs bar Wamboka from oversight committees",
          url: "https://www.standardmedia.co.ke/politics/article/2001550029/mps-bar-wamboka-from-oversight-committees",
        },
        {
          name: "Tuko — reassigned to Cohesion Committee",
          url: "https://www.tuko.co.ke/politics/627846-jack-wamboka-azimio-reassigns-bumula-mp-powerful-committee-weeks-corruption-suspension/",
        },
      ],
    },
  ],
  statement:
    "Oversight is confrontational work — and the same standards Hon. Wamboka applied to Cabinet Secretaries, universities and parastatals apply to him. The bribery allegation was tested and dismissed. The conduct finding was made, and it is published here in full. The measure of an accountability politician is not a spotless file; it is whether the file is open.",
};

/* --------------------------------------------------------- term timeline */

export const timeline: TimelineEvent[] = [
  {
    year: "2022",
    kind: "election",
    claim: "Elected MP for Bumula on a DAP-K ticket",
    detail:
      "Defeated the incumbent in a closely fought race; the two rivals publicly shook hands after the campaign. Official IEBC vote tallies will be published here once transcribed from the certified results.",
    date: "August 2022",
    status: "verified",
    sources: [
      {
        name: "The Star — Rivals Mwambu, Wamboka shake hands after fierce campaign",
        url: "https://www.the-star.co.ke/counties/coast/2022-08-29-rivals-mwambu-wamboka-shake-hands-after-fierce-campaign",
      },
    ],
  },
  {
    year: "2023",
    kind: "oversight",
    claim:
      "Took the chair of the Public Investments Committee on Governance & Education; opened the universities probe",
    detail:
      "Backdated the inquiry to FY 2019/20 to reach the root of Auditor-General queries across higher-education institutions.",
    date: "2023",
    status: "verified",
    sources: [
      {
        name: "KBC — PIC goes after institutions of higher learning",
        url: "https://www.kbc.co.ke/pic-goes-after-institutions-of-higher-learning/",
      },
    ],
  },
  {
    year: "2024",
    kind: "constituency",
    claim: "Full Form One scholarships for 20 top 2023-KCPE pupils",
    date: "January 2024",
    status: "verified",
    sources: [
      {
        name: "The Star — Bumula top pupils get full scholarships",
        url: "https://www.the-star.co.ke/counties/western/2024-01-16-bumula-top-pupils-in-2023-kcpe-get-full-form-one-scholarships/",
      },
    ],
  },
  {
    year: "2024",
    kind: "oversight",
    claim:
      "Moved the impeachment of Agriculture CS Mithika Linturi over the fake-fertiliser scandal",
    detail:
      "110 signatures; House endorsed the inquiry 149–36; the select committee cleared the CS 7–4 on party lines.",
    date: "May 2024",
    status: "verified",
    sources: [
      {
        name: "Daily Nation — Committee saves Linturi's job",
        url: "https://nation.africa/kenya/news/committee-saves-linturi-s-job-in-scandal-over-fake-fertiliser-4621248",
      },
    ],
  },
  {
    year: "2024",
    kind: "money",
    claim:
      "Led the charge against delayed NG-CDF disbursements; Treasury released phased billions",
    date: "December 2024",
    status: "verified",
    sources: [
      {
        name: "Kenyans.co.ke — demands suspension of National Assembly over delayed CDF",
        url: "https://www.kenyans.co.ke/news/110832-bumula-mp-demands-suspension-national-assembly-over-delayed-cdf-funds",
      },
    ],
  },
  {
    year: "2025",
    kind: "money",
    claim:
      "Bumula placed in the second-highest NG-CDF tier — KSh 197 million under the revised formula",
    date: "January 2025",
    status: "reported",
    sources: [
      {
        name: "The Star — Mt Kenya reaps big under latest NG-CDF formula",
        url: "https://www.the-star.co.ke/news/realtime/2025-01-22-mt-kenya-reaps-big-under-latest-ng-cdf-formula",
      },
    ],
  },
  {
    year: "2026",
    kind: "constituency",
    claim: "Bumula rises to top 3 in Bungoma education rankings",
    date: "January 2026",
    status: "reported",
    sources: [
      {
        name: "Horizon News — Bumula rises to top 3",
        url: "https://horizonnews.co.ke/2026/01/24/bumula-rises-to-top-3-in-bungoma-education-rankings-wamboka/",
      },
    ],
  },
  {
    year: "2026",
    kind: "integrity",
    claim:
      "Suspended as PIC chair over allegations; cleared of bribery in June — the conduct finding upheld",
    detail: "The complete chronology is published in the Integrity File.",
    date: "April–June 2026",
    status: "verified",
    sources: [
      {
        name: "Daily Nation — clears bribery claims, upholds ouster",
        url: "https://nation.africa/kenya/news/politics/parliament-clears-bumula-mp-of-bribery-claims-but-upholds-his-ouster-5493152",
      },
    ],
  },
];

/* ----------------------------------------------------------- methodology */

export const methodology = {
  intro:
    "This site is built like an audit file, not a poster. Its rules are fixed and public:",
  rules: [
    {
      title: "Every claim carries a source",
      body: "Nothing appears on this site without at least one publicly checkable reference — Parliament records, the NG-CDF Board, the Office of the Auditor-General, or credible national press. Click any source chip to check it yourself.",
    },
    {
      title: "Three verification statuses, honestly applied",
      body: "VERIFIED means the fact is confirmed in official records or multiple independent reports. REPORTED means credible press carried it but the official document is still to be transcribed. PENDING means the official figure has not yet been published or obtained — and we say so instead of inventing a number.",
    },
    {
      title: "The bad news is published too",
      body: "The Integrity File carries adverse findings in full, with the same sourcing standard as the achievements. A record with the rough parts removed is not a record.",
    },
    {
      title: "Money gets line-items, not adjectives",
      body: "Allocations are stated per financial year with official sources. Projects will be listed with location, budget and status. Auditor-General findings on Bumula NG-CDF will be published unedited when released.",
    },
  ],
  dataSources: [
    {
      name: "Parliament of Kenya",
      url: "https://www.parliament.go.ke/",
      what: "Hansard, committee records, official MP profile",
    },
    {
      name: "NG-CDF Board",
      url: "https://ngcdf.go.ke/allocations/",
      what: "Constituency allocations and project schedules",
    },
    {
      name: "NG-CDF Bumula Constituency",
      url: "https://bumula.ngcdf.go.ke/",
      what: "Constituency-level allocations, projects and bursaries",
    },
    {
      name: "Office of the Auditor-General",
      url: "https://www.oagkenya.go.ke/",
      what: "Audit reports on Bumula NG-CDF accounts",
    },
    {
      name: "Mzalendo — Eye on Kenyan Parliament",
      url: "https://mzalendo.com/parliament/politician/wamboka-jack/",
      what: "Independent parliamentary monitoring and Hansard archive",
    },
    {
      name: "IEBC",
      url: "https://www.iebc.or.ke/",
      what: "Certified election results",
    },
    {
      name: "National press",
      url: "#",
      what: "Daily Nation, The Standard, The Star, Capital News, Citizen Digital, People Daily, KBC and others — linked per fact",
    },
  ],
  disclaimer:
    "Prototype build. Entries marked PENDING await transcription of official records (IEBC certified results, NG-CDF Board schedules, OAG reports) and will be filled, with sources, before public launch. This site should be reviewed by the candidate's legal team before publication.",
};

export const nav = [
  { href: "/", label: "Overview" },
  { href: "/record/", label: "The Record" },
  { href: "/money/", label: "Money Trail" },
  { href: "/bumula/", label: "Bumula" },
  { href: "/integrity/", label: "Integrity File" },
  { href: "/methodology/", label: "Methodology" },
];

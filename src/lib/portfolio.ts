/* ==========================================================================
   Simboni Misiati Peter (SMP) — Portfolio content (single source of truth)
   --------------------------------------------------------------------------
   Everything the site shows lives here. Add a project, edit a skill, change a
   link — it updates everywhere (home grid, /work directory, the individual
   /work/[slug] case study, the sitemap and the SEO tags).

   Content sourced from the previous site (smp-developers.com). Add live URLs,
   screenshots and richer case-study detail as you have them.
   ========================================================================== */

/* ------------------------------- Profile -------------------------------- */

export const profile = {
  name: "Simboni Misiati Peter",
  shortName: "SMP",
  firstName: "Peter",
  /** Shown under the name in the hero. */
  role: "Software Engineer · Web Developer · Tech Consultant",
  /** Short second line used in the header/footer logo lockup. */
  logoTagline: "SMP Developers",
  /** The 5-second value proposition. Also the site's meta description.
   *  Kept to what a buyer can purchase: the youth-empowerment and
   *  financial-literacy work is real and it lives on /about, but in the hero
   *  it competes with the sentence that has to answer "can you build my
   *  system?" before the visitor leaves. */
  valueProp:
    "I design and build the business systems organisations run on \u2014 microfinance and SACCO platforms, ERP, inventory and point of sale, M-Pesa payments, websites and mobile apps. Nairobi and Bungoma, Kenya, and remote.",
  /** The home page's <h1>, and the first half of `valueProp`.
   *
   *  The home page had no <h1> at all. The screenshots were doing the talking,
   *  which works on a visitor who already knows what this is \u2014 and on nobody
   *  else. A search engine saw a page of images, and a screen reader landing
   *  on it was told the name of a carousel. These two lines are the smallest
   *  thing that answers "what is this and who is it for" before the pictures
   *  start, and they are kept as one sentence each so the hero still opens on
   *  the work rather than on a screen of reading. */
  headline: "I design and build the business systems organisations run on.",
  /** The second half of `valueProp`: what "business systems" actually means,
   *  in the buyer's words rather than in stack names. */
  headlineSupport:
    "Microfinance and SACCO platforms, ERP, inventory and point of sale, M-Pesa payments, websites and mobile apps.",
  /** A slightly longer hero support line. */
  tagline:
    "Software engineer and tech consultant from Kenya. I design and build custom software, websites and mobile apps — and help organisations put technology to work.",
  location: "Nairobi & Bungoma, Kenya",
  /** The hero status line. "Available for freelance" reads as looking for
   *  work; the green dot already says "open now", so this says what is open. */
  availability: "Taking on new projects \u00b7 Kenya & remote",
  email: "info@smp-developers.com",
  phone: "+254 706 289 514",
  whatsapp: "254706289514",
  /** Résumé link — add a URL here later to show the download button. */
  resumeUrl: "",
  socials: {
    github: "", // add your GitHub URL to show the icon
    linkedin: "", // add your LinkedIn URL to show the icon
    x: "",
    email: "info@smp-developers.com",
  },
  /** Answers "what kind of software?" directly under the headline. A visitor
   *  who cannot tell within one screen whether this is for them leaves. */
  offers: [
    "Business systems",
    "SACCO & microfinance",
    "M-Pesa integrations",
    "Websites & portals",
    "Mobile apps",
  ],
  /** Quick "by the numbers" stats. */
  stats: [
    { value: 10, suffix: "+", label: "Years in tech" },
    { value: 100, suffix: "+", label: "Projects delivered" },
    { value: 20, suffix: "+", label: "Clients served" },
    { value: 5, suffix: "", label: "Ventures led" },
  ],
} as const;

/* --------------------------------- About -------------------------------- */

export const about = {
  paragraphs: [
    "Hello — SMP here. I'm a software engineer, social entrepreneur and tech consultant passionate about driving social impact through technology. I've built innovative solutions like microfinance systems, ERP platforms and online learning tools, while empowering youth through mentorship and financial education.",
    "Through my studio, SMP Developers, I design and build custom software, websites and mobile apps end-to-end — from the first conversation to launch and handover. I work across the modern web and mobile, and I'm equally at home advising organisations on the right technology strategy.",
    "Beyond code, I lead SMP Eventures and run financial-literacy programmes that help young people earn, save and invest. My goal is simple: inspire positive change and build a future shaped by innovation and inclusion. If you're building something, I'd love to hear about it.",
  ],
  /** How I work — adapted from "why clients choose me". */
  principles: [
    {
      title: "Tailored, not templated",
      body: "I build solutions around your actual needs and goals — not a one-size-fits-all template.",
    },
    {
      title: "End-to-end ownership",
      body: "Discovery, design, development, deployment and handover — I own the whole journey and the outcome.",
    },
    {
      title: "Impact-driven",
      body: "I care about results that matter: systems that work, communities empowered, businesses that grow.",
    },
    {
      title: "Creativity & excellence",
      body: "A commitment to craft, clean execution and work I'm proud to put my name on.",
    },
  ],
} as const;

/* -------------------------------- Skills -------------------------------- */

export type SkillGroup = {
  title: string;
  icon: string;
  items: string[];
};

export const skills: SkillGroup[] = [
  {
    title: "Frontend",
    icon: "layout",
    items: ["TypeScript", "React", "Next.js", "Tailwind CSS", "JavaScript", "HTML / CSS"],
  },
  {
    title: "Backend",
    icon: "server",
    items: ["Node.js", "PHP", "Laravel", "Python", "Django", "REST APIs"],
  },
  {
    title: "WordPress & CMS",
    icon: "code",
    items: ["WordPress", "Elementor", "DIVI", "Gutenberg", "Theme Development"],
  },
  {
    title: "Databases & Systems",
    icon: "database",
    items: ["MySQL", "PostgreSQL", "ERP Systems", "Microfinance Systems"],
  },
  {
    title: "Mobile & Fintech",
    icon: "chart",
    items: ["Android", "iOS", "SACCO Systems", "Payments", "Savings & Investments"],
  },
  {
    title: "Design & Consulting",
    icon: "sparkle",
    items: ["Web Design", "Graphic Design", "Canva", "Photoshop", "Tech Strategy", "Git", "Notion"],
  },
];

/* ------------------------------ Experience ------------------------------ */

export type Job = {
  company: string;
  role: string;
  period: string;
  location?: string;
  summary: string;
  highlights: string[];
};

export const experience: Job[] = [
  {
    company: "SMP Developers",
    role: "Senior Developer",
    period: "2023 — Present",
    location: "Nairobi, Kenya",
    summary:
      "Lead development of systems, websites and mobile apps, and coordinate teams to raise output and product quality.",
    highlights: [
      "Deliver custom software, websites and apps end-to-end for clients across Kenya.",
      "Coordinate creative and development teams to ship quality products on time.",
      "Own everything from discovery and UX through deployment and handover.",
    ],
  },
  {
    company: "eLearners Academy",
    role: "Youth Empowerment & Financial Education",
    period: "2022 — Present",
    location: "Kenya",
    summary:
      "Train, inspire and collaborate with youth across the nation to improve livelihoods and financial independence.",
    highlights: [
      "Run financial-literacy and technology mentorship programmes for young people.",
      "Built learning tools and community platforms supporting the work.",
    ],
  },
  {
    company: "SMP Eventures Ltd",
    role: "Chairman & Director",
    period: "2015 — Present",
    location: "Kenya",
    summary:
      "Collaborate with creative and development teams on the execution of ideas across ventures.",
    highlights: [
      "Lead a multi-disciplinary team turning ideas into delivered projects.",
      "Founded and grew the venture alongside the software practice.",
    ],
  },
];

/* ------------------------------ Education ------------------------------- */

export type Education = {
  institution: string;
  qualification: string;
  period: string;
  detail?: string;
};

export const education: Education[] = [
  {
    institution: "Jomo Kenyatta University of Agriculture & Technology (JKUAT)",
    qualification: "Master's Degree in Software Engineering",
    period: "2023 — 2025",
    detail: "Nairobi, Kenya",
  },
  {
    institution: "JKUAT — Programming Certificate",
    qualification: "Software & App Development",
    period: "2024 — Present",
    detail: "Git, JavaScript, iOS, Android, PHP, Laravel, Python, Django, Notion.",
  },
  {
    institution: "WordPress Development",
    qualification: "Certification & Practice",
    period: "2015 — 2025",
    detail: "DIVI, Elementor, Gutenberg and full WordPress theme development.",
  },
];

/* ------------------------------- Clients -------------------------------- */

export type Client = { name: string; logo: string; link?: string };

export const clients: Client[] = [
  { name: "Talitha Kum International Kenya", logo: "/clients/talithakum.webp" },
  { name: "Golden Star Academy", logo: "/clients/golden-star.webp" },
  { name: "Dr. Wamalwa — Intersex Foundation", logo: "/clients/dr-wamalwa.png" },
  { name: "e-Learners Academy", logo: "/clients/elearners.webp" },
  { name: "KeYSA — Kenya Youth Support Association", logo: "/clients/keysa.png", link: "https://www.keysa.org" },
  { name: "Canossian Daughters of Charity", logo: "/clients/canossian.webp" },
  { name: "Zuri Hotels", logo: "/clients/zuri.png" },
  { name: "Holy Cross Junior School", logo: "/clients/admin-up.png" },
];

/* ------------------------------- Projects ------------------------------- */

export type Metric = { value: string; label: string };
export type ProjectLink = { label: string; href: string };

export type Project = {
  slug: string;
  title: string;
  summary: string;
  type: string;
  year: string;
  role: string;
  stack: string[];
  tags: string[];
  featured?: boolean;
  /** Own product given a spotlight band on the home page. */
  flagship?: boolean;
  /** The product's own accent colour, used by the flagship band. */
  accent?: string;
  /** Headline for the flagship band; falls back to the title. */
  flagshipHeadline?: string;
  cover: { from: string; to: string; initials: string };
  /** Brand logo for the "worked with" strip and partners page. */
  logo?: string;
  /** Background colour the logo was designed for (its site's header). */
  logoBg?: string;
  /** Grouping for the partners page tabs, e.g. "Web Apps", "Business", "NGOs". */
  category?: string;
  links: { live?: string; code?: string; extra?: ProjectLink };
  problem: string;
  approach: string;
  architecture: string[];
  highlights: string[];
  impact: Metric[];
  media: { src: string; alt: string }[];
};

export const projects: Project[] = [
  {
    slug: "stackup",
    title: "StackUp",
    summary:
      "An open, self-hostable work-management platform in the spirit of ClickUp — workspaces, tasks, docs, goals and dashboards, built module by module as a multi-tenant, real-time product.",
    type: "Product",
    year: "2026",
    role: "Product design & full-stack engineering",
    stack: ["NestJS", "PostgreSQL", "Next.js 15", "React 19", "TypeScript", "Capacitor", "Docker"],
    tags: ["Web App", "SaaS", "Product"],
    featured: true,
    flagship: true,
    accent: "#7B68EE",
    flagshipHeadline:
      "StackUp \u2014 the product I\u2019m building, not just shipping for clients.",
    cover: { from: "from-ink-700", to: "to-ink-950", initials: "SU" },
    logo: "/logos/stackup.svg",
    logoBg: "#ffffff",
    category: "Web Apps",
    links: { live: "https://stackup.co.ke", code: "https://github.com/simboni/smp-planning" },
    problem:
      "Teams juggle tasks, docs, goals and reporting across half a dozen tools. The all-in-one option (ClickUp) is powerful but closed and pricey. I wanted a clean, open, self-hostable alternative that a team can own — without giving up multi-tenancy, real-time collaboration or security.",
    approach:
      "I'm building StackUp module by module — each a working, testable slice: Workspaces → Spaces → Folders → Lists → Tasks, with List / Board / Calendar / Gantt views, Docs, Goals, Dashboards, Time Tracking and Automations. A NestJS API over raw SQL, a Next.js web client and a Capacitor mobile shell share one typed contract.",
    architecture: [
      "NestJS 11 API over raw SQL (pg); Next.js 15 + React 19 web (static export); Capacitor Android app — one pnpm monorepo, shared types.",
      "PostgreSQL 16 multi-tenancy via fail-closed Row-Level-Security: the app role is NOBYPASSRLS, every workspace table FORCEs RLS, no workspace context denies every query.",
      "Argon2id passwords with two-stage JWTs (identity → workspace-scoped access) and rotating refresh tokens; append-only audit log.",
      "A CI gate asserts cross-workspace isolation on every push; self-hosted on a single VPS \u2014 one container serves the API and the web export from the same origin, behind Caddy.",
    ],
    highlights: [
      "Security-first multi-tenancy — tenant isolation enforced in the database, not just the app, and proven by a CI gate.",
      "One codebase, three clients (API, web, mobile) sharing a typed contract.",
      "Open and self-hostable — a team can own its data end to end.",
    ],
    impact: [
      { value: "Multi-tenant", label: "Fail-closed RLS" },
      { value: "3 clients", label: "API · web · mobile" },
      { value: "Open", label: "Self-hostable" },
    ],
    media: [
      {
        src: "/mockups/stackup-dashboard.webp",
        alt: "StackUp — workspace dashboard: spaces, tasks, goals and recent activity",
      },
      {
        src: "/mockups/stackup-login.webp",
        alt: "StackUp — 'one app to plan, track, and get work done' sign-in",
      },
    ],
  },
  {
    slug: "naveedex",
    title: "Naveedex",
    summary:
      "A trading-journal SaaS where traders log trades, build strategies, track performance and export polished reports.",
    type: "Product",
    year: "2026",
    role: "Full-stack development",
    stack: ["Next.js", "TypeScript", "React", "Supabase", "PostgreSQL", "Tailwind CSS"],
    tags: ["Web App", "SaaS", "Fintech"],
    featured: true,
    cover: { from: "from-ink-700", to: "to-ink-950", initials: "NX" },
    logo: "/logos/naveedex.png",
    logoBg: "#0c1013",
    category: "Web Apps",
    links: { live: "https://naveedex.com" },
    problem:
      "Serious traders need more than a spreadsheet — a place to log every trade, review setups against a defined strategy, and see what's actually working. Most tools are clunky, generic or expensive.",
    approach:
      "I built Naveedex as a full trading-journal SaaS: fast trade logging, a strategy and setup library, performance analytics, a built-in knowledge base and an assistant — with subscriptions and shareable trade cards.",
    architecture: [
      "Next.js App Router + React + TypeScript on Supabase (auth + PostgreSQL).",
      "Strategy & setup library, trade logging and performance analytics.",
      "PDF & Excel report export (jsPDF, xlsx) and image trade-cards (html-to-image).",
      "Subscriptions via Kopo Kopo payments, an admin panel and scheduled cron jobs.",
      "Deployed on Vercel.",
    ],
    highlights: [
      "A complete SaaS — auth, payments, admin and a knowledge base.",
      "Shareable trade cards and one-click PDF / Excel exports.",
      "Strategy-driven journaling, not just a trade log.",
    ],
    impact: [
      { value: "SaaS", label: "Auth · payments · admin" },
      { value: "Export", label: "PDF · Excel · cards" },
      { value: "Supabase", label: "Realtime data" },
    ],
    media: [{ src: "/mockups/naveedex.webp", alt: "Naveedex — trading journal for serious traders" }],
  },
  {
    slug: "tallypay",
    title: "TallyPay",
    summary:
      "A multi-tenant SaaS billing platform — each business runs its whole money cycle (quote → invoice → receipt) with M-Pesa collection, PDFs and an admin console.",
    type: "Product",
    year: "2026",
    role: "Full-stack development",
    stack: ["Next.js 16", "TypeScript", "Cloudflare D1", "Drizzle ORM", "better-auth", "M-Pesa"],
    tags: ["Fintech", "SaaS", "Web App"],
    featured: true,
    cover: { from: "from-green-600", to: "to-ink-900", initials: "TP" },
    logo: "/logos/tallypay.png",
    logoBg: "#ffffff",
    category: "Web Apps",
    links: { live: "https://tallypay.co.ke" },
    problem:
      "Freelancers and small businesses in Kenya juggle quotes, invoices, VAT, deposits and receipts across spreadsheets and WhatsApp — with no clean way to get paid or see what's outstanding.",
    approach:
      "I built TallyPay as a multi-tenant SaaS: every business gets an isolated workspace to run the full money cycle — quotation → invoice (deposit + balance + 16% VAT) → receipt — with clients, a catalogue, delivery notes, share/PDF links, M-Pesa collection and a money dashboard. A free/Pro white-label split and a cross-tenant admin console round it out.",
    architecture: [
      "Next.js 16 (App Router + Server Actions) on Cloudflare Workers via OpenNext.",
      "Cloudflare D1 (SQLite) + Drizzle ORM; better-auth multi-tenant orgs — every query scoped by requireOrg().",
      "Money as integer KES cents, VAT in basis points — unit-tested accounting.",
      "M-Pesa STK push (Kopo Kopo) with auto-receipting; per-vendor accounts encrypted at rest.",
      "A4 PDF share links (Cloudflare Browser Rendering), Resend email, admin console with KPIs + audit log.",
    ],
    highlights: [
      "True multi-tenant SaaS — isolated workspaces, free/Pro white-label, admin console.",
      "M-Pesa collection with automatic receipting and per-vendor payout accounts.",
      "Correct-by-design accounting — integer cents, basis-point VAT, unit-tested.",
    ],
    impact: [
      { value: "Multi-tenant", label: "SaaS workspaces" },
      { value: "M-Pesa", label: "STK collection" },
      { value: "Quote→Receipt", label: "Full money cycle" },
    ],
    media: [{ src: "/mockups/tallypay.jpg", alt: "TallyPay — get paid without the paperwork" }],
  },
  {
    slug: "64-theatre",
    title: "64 Theatre",
    summary:
      "A production-grade ticketing platform for a Kenyan theatre — M-Pesa checkout, signed-QR tickets and an offline gate scanner.",
    type: "Client project",
    year: "2026",
    role: "Full-stack architecture & development",
    stack: ["Laravel 13", "PHP 8.4", "Filament 5", "SQLite", "M-Pesa", "Kopo Kopo"],
    tags: ["Web App", "Fintech", "Client"],
    featured: true,
    cover: { from: "from-green-700", to: "to-ink-950", initials: "64" },
    logo: "/logos/64-theatre.png",
    logoBg: "#130d0f",
    category: "Web Apps",
    links: { live: "https://tickets.64theatre.art" },
    problem:
      "64 Theatre Limited (Eldoret) needed to sell tickets online, take mobile-money payments, and check guests in reliably at the gate — even when the venue's internet drops. They also needed to start selling before Safaricom had approved a paybill in their own name.",
    approach:
      "I designed and built a modular Laravel platform: public event pages with a three-step M-Pesa checkout, signed-QR ticket delivery, a Filament admin and an offline-capable gate scanner. Payments go through Kopo Kopo so the theatre could sell before its own Safaricom paybill was approved — the gateway is a swappable seam, so moving to Daraja is one environment variable.",
    architecture: [
      "Laravel 13 / PHP 8.4 modular monolith, Filament 5 admin, SQLite on a persistent volume.",
      "M-Pesa STK Push via Kopo Kopo, with a signed webhook; Pesapal and Safaricom Daraja behind the same interface.",
      "HMAC-signed QR tickets verifiable offline; double-entry ledger for every sale.",
      "Deployed on a shared VPS behind Caddy — its own compose project, no published port, alongside eleven other services.",
    ],
    highlights: [
      "Offline-first gate scanner — tickets verify without internet.",
      "Double-entry money ledger; every ticket redeems exactly once (DB-enforced).",
      "Box office can push an M-Pesa prompt to a walk-up buyer, or take cash.",
      "Payment provider switchable from the admin; credentials never leave the server.",
    ],
    impact: [
      { value: "Live", label: "tickets.64theatre.art" },
      { value: "M-Pesa", label: "Checkout and box office" },
      { value: "Offline", label: "Gate scanner" },
    ],
    media: [{ src: "/mockups/64-theatre.jpg", alt: "64 Theatre — now showing" }],
  },
  {
    slug: "fit-generations",
    title: "Fit Generations",
    summary:
      "A fast, modern platform for a Kenyan gym — a dark athletic site with class timetables, pricing, a live BMI calculator and a member-portal.",
    type: "Client project",
    year: "2026",
    role: "Design & full-stack development",
    stack: ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS v4"],
    tags: ["Web", "Fitness", "Client"],
    featured: true,
    cover: { from: "from-green-500", to: "to-ink-900", initials: "FG" },
    logo: "/logos/fit-generations.png",
    logoBg: "#0a0a0a",
    category: "Business",
    links: { live: "https://fitgenerationsgym.com" },
    problem:
      "Fit Generations Gym (Bungoma) was stuck on a slow, dated WordPress site. They needed a fast, modern platform to show their classes, coaches and pricing — one that could grow into a member portal.",
    approach:
      "I rebuilt it from scratch with a dark athletic theme (ink black · lime green · ember red): 16 programs, an interactive weekly timetable, coaches, pricing, a live BMI calculator and WhatsApp quick-chat — all editable from one content file.",
    architecture: [
      "Next.js 16 App Router, React 19, TypeScript, Tailwind v4.",
      "All content in one typed file — edits update everywhere.",
      "Interactive timetable tabs, animated counters, BMI calculator, newsletter capture.",
      "Member-portal teaser wired for the Phase 2 admin dashboard.",
    ],
    highlights: [
      "Replaced a slow WordPress site with a fast, modern build.",
      "16 programs plus a live weekly timetable and BMI calculator.",
      "Editable-by-the-owner content model.",
    ],
    impact: [
      { value: "WordPress→", label: "Modern rebuild" },
      { value: "16", label: "Programs & timetable" },
      { value: "Live", label: "BMI · WhatsApp" },
    ],
    media: [
      { src: "/mockups/fit-generations.jpg", alt: "Fit Generations Gym — home page" },
      { src: "/mockups/fit-generations-classes.jpg", alt: "Fit Generations — classes & timetable" },
      { src: "/mockups/fit-generations-gym.jpg", alt: "Inside Fit Generations Gym" },
    ],
  },
  {
    slug: "misiati-associates",
    title: "Misiati & Associates",
    summary:
      "A production website and lead pipeline for a firm of Certified Public Accountants in Kenya.",
    type: "Client project",
    year: "2026",
    role: "Design & full-stack development",
    stack: ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS v4", "Cloudflare Pages"],
    tags: ["Web", "Client"],
    featured: false,
    cover: { from: "from-ink-600", to: "to-ink-900", initials: "M&A" },
    logo: "/logos/misiati-associates.png",
    logoBg: "#ffffff",
    category: "Business",
    links: { live: "https://misiatiassociates.co.ke" },
    problem:
      "An established accounting firm had no web presence — prospective clients couldn't find them, verify credentials or get in touch, and competitors with even a basic site were winning that first impression.",
    approach:
      "I ran a short discovery, designed a trust-first brand system, and built a fast static site around a single editable content file so the firm can update details without a developer.",
    architecture: [
      "Next.js 16 App Router with static export — no server, deploys anywhere.",
      "All firm data in one typed source file; pages render from it.",
      "Contact form with email + WhatsApp fallback.",
      "Cloudflare Pages with automatic builds; SEO, Open Graph, sitemap and JSON-LD.",
    ],
    highlights: [
      "Sub-second first load and a flawless mobile layout on a zero-cost static host.",
      "Editable-by-the-client architecture — add a service by appending one object.",
    ],
    impact: [
      { value: "0→1", label: "Web presence launched" },
      { value: "<1s", label: "First load on mobile" },
      { value: "100%", label: "Static — no hosting cost" },
    ],
    media: [{ src: "/mockups/misiati-associates.jpg", alt: "Misiati & Associates — home" }],
  },
  {
    slug: "misiati-mc",
    title: "Misiati MC",
    summary:
      "A bold personal-brand site for Emmanuel Misiati — a professional Master of Ceremonies, facilitator and moderator — turning 'I hold the room' into booked events across Nairobi and East Africa.",
    type: "Personal brand",
    year: "2026",
    role: "Design & full-stack development",
    stack: ["Next.js", "React", "TypeScript", "Tailwind CSS"],
    tags: ["Web", "Personal brand"],
    featured: false,
    cover: { from: "from-ink-700", to: "to-ink-950", initials: "MC" },
    logoBg: "#f5f0e6",
    category: "Business",
    links: { live: "https://facilitator-misiati.onrender.com" },
    problem:
      "A working MC, facilitator and moderator needed a site that sells his room-holding energy in seconds — the range (corporate summits, NGO convenings, founder gatherings, youth rooms), the track record, and a dead-simple way to check availability and book.",
    approach:
      "I designed a high-energy, editorial brand — oversized 'I HOLD THE ROOM' typography, a cut-out hero, animated outline lettering and a rolling wall of past clients — with 'check availability' calls-to-action throughout and a clear Services / Work / About / Contact structure. Built fast and mobile-first.",
    architecture: [
      "Bold editorial layout: oversized type, a cut-out hero and a scrolling client wall.",
      "Services, Work, About and Contact sections with prominent 'check availability' CTAs.",
      "Fast, responsive, mobile-first build.",
      "Deployed on Render — final domain to follow.",
    ],
    highlights: [
      "A hero that sells the value in a single line — 'I hold the room.'",
      "Social proof front and centre: a rolling wall of past clients and convenings.",
      "A clear booking path — 'check availability' from anywhere on the page.",
    ],
    impact: [
      { value: "1,500+", label: "Hours on the clock" },
      { value: "5+", label: "Years MC'ing" },
      { value: "Nairobi", label: "→ East Africa" },
    ],
    media: [
      {
        src: "/mockups/misiati-mc.webp",
        alt: "Misiati MC — 'I hold the room' facilitator & master of ceremonies homepage",
      },
    ],
  },
  {
    slug: "zuri-place-resort",
    title: "Zuri Hotels & Resorts",
    summary:
      "'Stay. Feast. Unwind.' — one online home for six boutique properties across Kenya and Uganda, with a cross-property stay search and WhatsApp-first booking.",
    type: "Client project",
    year: "2026",
    role: "Design & full-stack development",
    stack: ["HTML/CSS/JS", "Caddy", "Docker", "Railway"],
    tags: ["Web", "Hospitality", "Client"],
    featured: false,
    cover: { from: "from-green-600", to: "to-ink-900", initials: "ZH" },
    logo: "/clients/zuri.png",
    logoBg: "#101712",
    category: "Business",
    links: { live: "https://zuriplaceresort.com" },
    problem:
      "Zuri Hotels runs six boutique properties across two countries — Zuri Poa & Zuri Resort in Makutano, the Zuri Place Restaurant & Sports Lounge in Kanduyi, Bungoma, and the Zuri Eden Safari Hotel in Malaba, Uganda. Guests had no single place to see the rooms, the dining and the group's full range, or to book across properties.",
    approach:
      "I designed one dark, editorial brand home — 'Stay. Feast. Unwind.' — with a property-aware stay search (check-in, check-out, guests, any Zuri property), dedicated pages per property and for the restaurant & sports lounge, a light/dark theme, and WhatsApp-first booking with Kenya and Uganda phone lines one tap away.",
    architecture: [
      "Hand-built static HTML/CSS/JS — no framework, no CMS, nothing to break.",
      "Cross-property stay search and per-property pages (Poa/Resort, Restaurant, Eden Safari Uganda).",
      "WhatsApp-first booking with click-to-call lines for Kenya (+254) and Uganda (+256).",
      "Served by Caddy in Docker, deployed on Railway.",
    ],
    highlights: [
      "Six properties in two countries under one credible brand home.",
      "A booking search that routes guests to the right property.",
      "Fast, dependency-free static build — cheap to host, easy to keep alive.",
    ],
    impact: [
      { value: "6", label: "Properties, one home" },
      { value: "2", label: "Countries (KE & UG)" },
      { value: "24/7", label: "WhatsApp booking" },
    ],
    media: [
      {
        src: "/mockups/zuri-place-resort.webp",
        alt: "Zuri Hotels & Resorts — 'Stay. Feast. Unwind.' booking homepage",
      },
    ],
  },
  {
    slug: "cosdep-kenya",
    title: "COSDEP Kenya",
    summary:
      "A modern website for a Kenyan sustainable-development NGO working with smallholder farmers — telling their story, programmes and impact to donors, partners and the communities they serve.",
    type: "Client project",
    year: "2026",
    role: "Design & full-stack development",
    stack: ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS v4"],
    tags: ["Web", "Non-profit", "Client"],
    featured: true,
    cover: { from: "from-green-500", to: "to-ink-900", initials: "CK" },
    logo: "/logos/cosdep-kenya.png",
    logoBg: "#f6f3ea",
    category: "NGOs",
    links: { live: "https://cosdepkenya.org" },
    problem:
      "COSDEP does the kind of grassroots work — sustainable agriculture, value addition, kitchen gardening — that donors and partners fund when they can see it. But without a strong, credible web presence, that story wasn't reaching the people who could support it or the communities who could benefit.",
    approach:
      "I designed a clean, mission-first site that leads with the work: programmes, projects and clear ways to get involved, anchored by a strong 'Turning harvests into income' hero and prominent donate paths. It's built on a fast Next.js stack with all content in one editable source, so the team can keep it current without a developer.",
    architecture: [
      "Next.js 16 App Router with static export — fast, secure, cheap to host.",
      "Programmes, projects and get-involved sections driven by a typed content model.",
      "Prominent donate and partnership calls-to-action throughout the journey.",
      "SEO, Open Graph, sitemap and JSON-LD so the mission is discoverable.",
    ],
    highlights: [
      "A mission-first layout that puts programmes and impact front and centre.",
      "Fast, mobile-first experience for a largely mobile Kenyan audience.",
      "Clear donate and get-involved paths to convert visitors into supporters.",
    ],
    impact: [
      { value: "0→1", label: "Credible online home" },
      { value: "Donate", label: "Paths front & centre" },
      { value: "Mobile", label: "First, for reach" },
    ],
    media: [{ src: "/mockups/cosdep-kenya.webp", alt: "COSDEP Kenya — turning harvests into income" }],
  },
  {
    slug: "canossian-sisters-ne-africa",
    title: "Canossian Sisters NE Africa",
    summary:
      "A warm, mission-first website for the Canossian Daughters of Charity — Servants of the Poor — serving across Tanzania, Kenya, Uganda and Sudan through education, evangelization, healthcare and prayer.",
    type: "Client project",
    year: "2026",
    role: "Design & full-stack development",
    stack: ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS v4"],
    tags: ["Web", "Non-profit", "Client"],
    featured: false,
    cover: { from: "from-green-500", to: "to-ink-900", initials: "CS" },
    logo: "/logos/canossian-sisters-ne-africa.webp",
    logoBg: "#ffffff",
    category: "NGOs",
    links: { live: "https://canossiansistersneafrica.org" },
    problem:
      "The Canossian Sisters touch over 100,000 lives across four countries, but their story — the ministries, the causes, the communities they serve — had no strong online home where supporters could learn about the work, get involved and give.",
    approach:
      "I designed and built a warm, mission-first website led by a 'Loving without measure' hero and the sisters' ministries and causes, with Donate and get-involved paths throughout — plus a gallery and a feature marking the 250th anniversary of St Magdalene of Canossa. It runs on a fast Next.js stack the team can keep current.",
    architecture: [
      "Next.js 16 App Router with static export — fast, secure, cheap to host.",
      "About, Ministries, Causes and Gallery sections driven by a typed content model.",
      "Prominent Donate and get-involved calls-to-action throughout the journey.",
      "SEO, Open Graph, sitemap and JSON-LD so the mission is discoverable.",
    ],
    highlights: [
      "A mission-first hero and stats that lead with real reach — 100,000+ lives, four countries.",
      "Clear Donate and get-involved paths to turn visitors into supporters.",
      "Fast, mobile-first experience for a largely mobile audience across East Africa.",
    ],
    impact: [
      { value: "100k+", label: "Lives touched" },
      { value: "4", label: "Countries served" },
      { value: "5", label: "Ministries" },
    ],
    media: [
      {
        src: "/mockups/canossian-sisters-ne-africa.webp",
        alt: "Canossian Sisters NE Africa — 'Loving without measure' mission homepage",
      },
    ],
  },
  {
    slug: "smp-credits",
    title: "SMP Credits",
    summary:
      "Modern lending, powered by M-Pesa — a back office for the lending team and an app for members, on web and Android. Loans, savings, approvals, payments and reporting in one system.",
    type: "Product",
    year: "2026",
    role: "Product design & full-stack engineering",
    stack: ["Web admin", "Member web app", "Android app", "M-Pesa"],
    tags: ["Fintech", "SaaS", "Web App", "Product"],
    featured: true,
    flagship: true,
    accent: "#5A8F1E",
    flagshipHeadline:
      "SMP Credits \u2014 lending that runs on M-Pesa, from the back office to the member\u2019s phone.",
    cover: { from: "from-green-600", to: "to-ink-950", initials: "SC" },
    logo: "/logos/smp-credits.webp",
    logoBg: "#ffffff",
    category: "Web Apps",
    links: { live: "https://smpcredits.co.ke" },
    problem:
      "Small lenders, SACCOs and chamas run their books on spreadsheets and WhatsApp: loan balances recalculated by hand, M-Pesa payments reconciled from SMS, approvals decided in a group chat and no reliable answer to the only question that matters — what is actually outstanding, and who owes it.",
    approach:
      "I built SMP Credits as two connected surfaces over one lending engine. The back office gives the team a live loan book split into principal, interest and admin fees, work queues for approvals, unallocated payments and ageing loans, plus members, savings, reports and an audit log. Members get their own app — web and Android — to see their balance, repay by M-Pesa in seconds, save and withdraw, and pull a statement without calling the office.",
    architecture: [
      "Two surfaces on one engine: an admin back office for staff and a member app shipped to both web and Android.",
      "M-Pesa repayment from inside the member app, with collections reconciling against each member's loan automatically.",
      "A loan book broken down into principal, interest and admin fees, with lending-versus-collections trends over twelve months.",
      "Work queues that surface what needs a human: loans waiting for approval, unallocated payments, members to review and loans ageing past 90 days.",
      "Tiered member loan levels, savings with deposit and withdrawal, staff roles and an audit log of who did what.",
      "Light and dark themes across admin and member app; Play Store build with icon and store listing assets.",
    ],
    highlights: [
      "One system covering both sides of lending — the team's back office and the member's phone.",
      "M-Pesa repayment in seconds, replacing SMS reconciliation with automatic allocation.",
      "Work queues and an audit log that turn a spreadsheet into something a lender can actually control.",
      "Shipped to web and Android from one product, with store-ready listing assets.",
    ],
    impact: [
      { value: "Web + Android", label: "Member app" },
      { value: "M-Pesa", label: "Repayment & collection" },
      { value: "Audit log", label: "Every action traced" },
    ],
    media: [
      { src: "/mockups/smp-credits-hero.webp", alt: "SMP Credits — modern lending, powered by M-Pesa: back office and member app" },
      { src: "/mockups/smp-credits-admin.webp", alt: "SMP Credits admin — outstanding loan book, work queues and lending-vs-collections" },
      { src: "/mockups/smp-credits-member.webp", alt: "SMP Credits member app — loan balance, savings and M-Pesa repayment" },
      { src: "/mockups/smp-credits-reports.webp", alt: "SMP Credits admin — reports" },
      { src: "/mockups/smp-credits-android.webp", alt: "SMP Credits on Android — member home screen" },
    ],
  },
  {
    // Slug unchanged on purpose: /work/riziki-chemicals is already linked from
    // outside and a tidier URL is not worth a dead one. The TITLE leads with
    // the POS, which is the system that runs the business — the brochure site
    // is the smaller half and was reading as the headline.
    slug: "riziki-chemicals",
    title: "Riziki POS",
    summary:
      "The point-of-sale, stock and production system an industrial-chemicals business runs on — selling, invoicing, credit, repacking and batch production from versioned formulas — plus the company website alongside it.",
    type: "Client project",
    year: "2026",
    role: "Product design & full-stack engineering",
    stack: ["Next.js 16", "React 19", "TypeScript", "SQLite", "Tailwind CSS v4", "Docker", "Caddy"],
    tags: ["POS", "Web App", "Business", "Client"],
    featured: true,
    cover: { from: "from-green-600", to: "to-ink-950", initials: "RP" },
    // No logo file, so the "worked with" strip draws the name — dark text,
    // which needs a light chip under it or it vanishes in the dark theme.
    logoBg: "#ffffff",
    category: "Business",
    links: { live: "https://pos.rizikichemicals.co.ke", extra: { label: "Company website", href: "https://rizikichemicals.co.ke" } },
    problem:
      "Riziki buys detergent chemicals in bulk drums and bags, repacks them into smaller sizes, and blends finished products from its own recipes — then sells to walk-in retail and to wholesale buyers who take goods on credit. All of it ran on paper. Stock never reconciled, credit was tracked from memory, and the owner's formulas and margins had to stay invisible to counter staff.",
    approach:
      "I built two applications: a public website for products and enquiries, and a point-of-sale system covering the whole operation — selling, invoicing, stock, repacking, batch production from versioned formulas, customers and credit, purchases, expenses, stocktakes, day-close cash counts, reports and an activity log. The counter runs offline-tolerant, and the owner's view is gated server-side so staff never receive formulas, cost prices or profit.",
    architecture: [
      "Next.js 16 (App Router, Server Actions) + React 19 + TypeScript on SQLite via node:sqlite; deployed with Docker and Caddy HTTPS on a VPS, with nightly backups.",
      "Money as integer cents and quantity as integer thousandths — no floating-point drift anywhere in stock or accounting.",
      "Stock is an append-only ledger: the database physically blocks UPDATE and DELETE on stock movements, so quantities can only change by posting a movement.",
      "Sales are immutable — voiding posts compensating movements — and prices are snapshotted onto sale lines so reports can never be rewritten by a later price change.",
      "Formulas are versioned: editing a recipe inserts a new version, and every batch records the version it was produced from.",
      "Role-gated server-side: formulas, cost prices and profit are never sent to a staff session. Offline service worker, ESC/POS receipt printing, and Africa/Nairobi business dates so evening sales land on the right day.",
    ],
    highlights: [
      "A trade-secret boundary enforced on the server — staff can sell without ever seeing a formula, a cost or a margin.",
      "Append-only stock and immutable sales: the books reconcile because history physically cannot be edited.",
      "Versioned formulas and batch production tying every mixed product back to the exact recipe used.",
      "Offline-tolerant counter with receipt printing, day-close cash counts and a full activity log.",
    ],
    impact: [
      { value: "20+", label: "Screens, counter to reports" },
      { value: "10", label: "Unit-test suites" },
      { value: "Ledger", label: "Append-only stock" },
    ],
    media: [
      {
        src: "/mockups/riziki-pos-till.webp",
        alt: "Riziki POS counter — products mixed to order priced by their chemicals, with a running sale and the total to pay",
      },
      {
        src: "/mockups/riziki-pos-dashboard.webp",
        alt: "Riziki POS dashboard — takings and debtors for the day, and stock movement valued at cost: opening, bought, made, sold, used in mixing and closing",
      },
      {
        src: "/mockups/riziki-pos-sales.webp",
        alt: "Riziki POS sales history — 1,248 sales with retail and wholesale standing, part-paid balances, and filters for unpaid and on-account",
      },
      {
        src: "/mockups/riziki-pos-signin.webp",
        alt: "Riziki POS sign-in — each person has their own PIN so every sale is recorded against them",
      },
    ],
  },
  {
    // Written from the code and the blueprint in simboni/dawapoint, not from
    // the screenshots alone — every capability below has an implementation
    // behind it. The screens are the live deployment carrying its training
    // catalogue (200 products, six suppliers), which is why DawaPoint sits in
    // the catalogue and not on the home page's wall: that wall is for screens
    // out of a business trading on the system, and this one has not gone live
    // with a pharmacy's own stock yet. Promote it when it does.
    slug: "dawapoint",
    title: "DawaPoint",
    summary:
      "A pharmacy point of sale and stock system for Kenyan chemists — it sells by pack, strip or single tablet, hands out the earliest-expiring stock first, takes M-Pesa at the till, and keeps the controlled-drugs register and insurance claims in the same place.",
    type: "Client project",
    year: "2026",
    role: "Product design & full-stack engineering",
    stack: ["Next.js 16", "React 19", "TypeScript", "Hono", "PostgreSQL 16", "Drizzle ORM", "Better Auth", "IndexedDB (Dexie)", "Turborepo", "Docker"],
    tags: ["POS", "Web App", "Business", "Client"],
    featured: true,
    cover: { from: "from-green-700", to: "to-ink-950", initials: "DP" },
    logoBg: "#ffffff", // wordmark chip, as for Riziki POS
    category: "Business",
    links: { live: "https://dawapoint.smp.co.ke" },
    problem:
      "A Kenyan retail chemist sells the same medicine by the pack, the strip and the single tablet, and most systems model one unit — so staff divide in their heads and the stock count drifts. Expiry quietly eats margin when nobody can see which batch goes off next. M-Pesa is checked on a cashier's own phone, cash variances have no owner, the internet and power both drop, controlled-drug records are what a PPB inspection looks at first, and insurers pay only on itemised, correctly referenced claims.",
    approach:
      "I built it as a counter first: scan or type, Enter adds, function keys for tender, hold and recall, and every product priced per unit it is sold in. Behind the counter sits a batch-level stock ledger fed by goods-received notes, so the till can sell first-expiry-first-out; shifts that open with a float and close with a blind count; M-Pesa prompts sent from the till; a prescription and controlled-drugs register; insurance claims raised against receipts; supplier balances and reports. It shipped with a written acceptance script, staff training sheets and an owner's handover pack, not just the software.",
    architecture: [
      "A pnpm/Turborepo monorepo: a Next.js 16 back office and point-of-sale terminal (installable PWA), a Hono API, and shared packages for domain logic, the database, auth, Zod contracts and design tokens.",
      "Domain rules — money, units of measure, access control, first-expiry-first-out allocation, pricing and reordering — live in a package with no I/O at all, tested on their own.",
      "PostgreSQL row-level security: the API connects as a role that owns nothing, and every tenant table filters on a tenant id set per transaction, so one pharmacy's query cannot read another's rows even by mistake.",
      "The audit trail is an append-only table whose rows are SHA-256 chained; an endpoint recomputes the chain to prove nothing was edited after the fact.",
      "The counter keeps selling offline: catalogue and prices cached in IndexedDB, sales held in a durable outbox and synced when the connection returns.",
      "M-Pesa through Daraja STK Push from the till, confirmed by callback with a status query as the fallback, and a simulator for training without real money.",
    ],
    highlights: [
      "Sells the way a chemist does — by pack, strip or single tablet, each with its own price — while stock is held in base units, so the count still adds up.",
      "Every supplier delivery creates batches with expiry dates, and the counter hands out the earliest-expiring first.",
      "Prescription and controlled medicines are flagged on the product; a controlled sale goes into a register that needs a witness.",
      "Insurance claims raised against the receipt, tracked from draft to paid, and exported for the insurer's portal.",
      "An audit log that can prove it has not been edited.",
    ],
    impact: [
      { value: "FEFO", label: "Earliest expiry sold first" },
      { value: "Offline", label: "The counter keeps selling" },
      { value: "21", label: "Test suites, plus 10 browser specs" },
    ],
    media: [
      {
        src: "/mockups/dawapoint-counter.webp",
        alt: "DawaPoint counter — barcode search, the fast-moving medicines priced by capsule, strip and pack, today's receipts on the till, and an empty cart ready to take cash, M-Pesa or card",
      },
      {
        src: "/mockups/dawapoint-products.webp",
        alt: "DawaPoint product catalogue — each medicine with its units and prices, stock on hand, stock value, earliest expiry date and whether it is over the counter or prescription-only",
      },
      {
        src: "/mockups/dawapoint-receiving.webp",
        alt: "DawaPoint goods received — notes from six pharmaceutical suppliers, each posted to stock as batches",
      },
      {
        src: "/mockups/dawapoint-claims.webp",
        alt: "DawaPoint insurance claims — awaiting payment, submitted and rejected totals, and a new claim against a receipt with member number, policy, pre-authorisation code and co-pay",
      },
    ],
  },
  {
    // Written from simboni/civora's own README and code. The live instance is
    // KEYSA's, freshly set up — the screens show the structure and the
    // workflow, not a year of data, so like DawaPoint it belongs in the
    // catalogue rather than on the home page wall until it has some.
    slug: "civora",
    title: "Civora",
    summary:
      "An operations platform for NGOs that follows one activity from the grant and its budget, through the field report and its evidence, to the money spent and the report the donor receives — running for KEYSA.",
    type: "Product",
    year: "2026",
    role: "Product design & full-stack engineering",
    stack: ["Next.js 16", "React 19", "TypeScript", "PostgreSQL", "Drizzle ORM", "Tailwind CSS 4", "IndexedDB (offline)", "IMAP / SMTP", "Docker"],
    tags: ["Web App", "SaaS", "Non-profit", "Product"],
    featured: true,
    cover: { from: "from-green-700", to: "to-ink-950", initials: "CV" },
    logoBg: "#ffffff", // wordmark chip, as for Riziki POS
    category: "NGOs",
    links: { live: "https://civora.smp.co.ke" },
    problem:
      "In most NGOs the activity, the field report that proves it happened, the expense it caused and the budget line it was charged to live in four different places — a spreadsheet, a WhatsApp group, a paper form and an email thread. Approvals leave no record, field staff work where the signal drops, and every donor report is rebuilt by hand from whatever can be found.",
    approach:
      "I built one spine rather than a pile of modules: grant → project → budget lines → activity → field report (offline) → supervisor review → M&E validation → indicator results, and alongside it expense request → approval chain → payment → budget position → donor report pack. It is deliberately not an ERP, a payroll engine or a donor CRM. A new organisation registers and gets starter departments, budget categories, approval policies and a report template, so the core workflow runs on the first day.",
    architecture: [
      "A Next.js 16 modular monolith (App Router, Server Actions) on PostgreSQL with Drizzle — each area owns its queries, actions and business rules, and the pages stay thin.",
      "Multi-tenant from the start: every query is scoped by organisation, and project-scoped roles see only their own projects — enforced in server actions and API routes, not just hidden in the interface.",
      "Field reports work offline: saved on the device first and synced with an idempotent client id, so a retry on a bad connection never files the same report twice.",
      "Configurable approval policies by amount band, request type, grant and department; nobody approves their own request, and approval is never mistaken for payment.",
      "Built-in mail: each person connects their own mailbox over IMAP/SMTP, kept live with IMAP IDLE and pushed to the browser over Server-Sent Events, with credentials encrypted (AES-256-GCM) and any email filed against a grant, project or request.",
      "An append-only audit log with before-and-after snapshots, and every export recorded.",
    ],
    highlights: [
      "One record from plan to proof: a validated field report feeds the indicator results automatically, and an approved expense moves the budget line's live position.",
      "Reported, reviewed and validated figures are kept separate, so a donor can see which numbers M&E has signed off.",
      "Present mode turns live figures into board-meeting slides whose titles state the takeaway — no deck to build.",
      "A per-grant donor report pack: the award, financial summary, results against targets, delivery and evidence for any period.",
    ],
    impact: [
      { value: "15", label: "Modules on one workflow" },
      { value: "7", label: "Roles tested end to end in a browser" },
      { value: "Offline", label: "Field reports sync when signal returns" },
    ],
    media: [
      {
        src: "/mockups/civora-overview.webp",
        alt: "Civora overview for KEYSA — the eight-step core workflow from team and grant to an approved, paid expense, with delivery, approvals, field reports and payments alongside",
      },
      {
        src: "/mockups/civora-departments.webp",
        alt: "Civora departments — KEYSA's org chart with Finance, Human Resources & Admin, Monitoring & Evaluation and Programmes, each with its lead, people and projects",
      },
    ],
  },
  {
    slug: "talitha-kum-kenya",
    title: "Talitha Kum International Kenya",
    summary:
      "A dignified, mission-first website for RAHT — Religious Against Human Trafficking, Kenya — the national anti-trafficking network of over 40 religious institutes, part of the global Talitha Kum family.",
    type: "Client project",
    year: "2026",
    role: "Design & web development",
    stack: ["WordPress", "PHP", "Responsive Design"],
    tags: ["Web", "Non-profit", "Client"],
    featured: true,
    cover: { from: "from-green-700", to: "to-ink-900", initials: "TK" },
    logo: "/logos/talitha-kum-kenya.webp",
    logoBg: "#ffffff",
    category: "NGOs",
    links: { live: "https://talithakumraht.org" },
    problem:
      "RAHT-Kenya unites more than 40 religious institutes against human trafficking, but its message — the vision, the four-Ps approach, how to report a case, get help or get involved — needed one credible, nationwide online home that the network and the public could rely on.",
    approach:
      "I designed and built a warm, dignified site led by the network's vision — 'A world free from human trafficking' — and its mission to uphold human dignity. The journey is organised around the four Ps (Prevention, Protection, Partnership, Prayer), with clear report / get-help and get-involved paths, news and an about section, all easy for the team to keep current.",
    architecture: [
      "WordPress CMS so the team can publish news and update content without a developer.",
      "A four-Ps framework structuring how the mission and programmes are told.",
      "Prominent report / get-help and get-involved calls-to-action throughout.",
      "Fast, mobile-first and SEO-ready so the message reaches a largely mobile audience.",
    ],
    highlights: [
      "A mission-first hero that leads with the network's vision and dignity.",
      "The four Ps — Prevention, Protection, Partnership, Prayer — made clear and navigable.",
      "Report / get-help and get-involved paths that turn awareness into action.",
    ],
    impact: [
      { value: "40+", label: "Religious institutes" },
      { value: "4 Ps", label: "Guiding framework" },
      { value: "Nationwide", label: "Reach across Kenya" },
    ],
    media: [
      {
        src: "/mockups/talitha-kum-kenya.webp",
        alt: "Talitha Kum International Kenya (RAHT) — 'A world free from human trafficking' homepage",
      },
    ],
  },
  {
    slug: "dennis-wamalwa",
    title: "Dr. Dennis Wamalwa",
    summary:
      "A political & advocacy brand site for a Kenya National Commission on Human Rights commissioner — telling a two-decade human-rights story and turning it into a movement.",
    type: "Political brand",
    year: "2026",
    role: "Design & full-stack development",
    stack: ["HTML/CSS/JS", "Render"],
    tags: ["Web", "Political", "Client"],
    featured: false,
    cover: { from: "from-ink-700", to: "to-ink-950", initials: "DW" },
    logo: "/logos/dennis-wamalwa.svg",
    logoBg: "#f6efe1",
    category: "Political",
    links: { live: "https://www.commrdrdenniswamalwa.co.ke" },
    problem:
      "Dr. Dennis Wamalwa has spent over two decades defending Kenya's most vulnerable as a KNCHR commissioner, but that record lived in fragments — he needed one credible home that tells the story, shows the work, and turns supporters into a movement.",
    approach:
      "I designed a warm, dignified political brand — an 'Equal rights for every person' hero, a story-led journey, a work and news/press archive, a gallery, and clear 'join the movement' and 'support' calls-to-action — with a light/dark theme. Built fast and mobile-first.",
    architecture: [
      "Hand-built static HTML/CSS/JS with a light/dark theme — nothing to break, cheap to host.",
      "About, My Work, News & Press and Gallery pages, plus a partner strip (KNCHR, NANHRI, Centre for Human Rights and more).",
      "Prominent 'join the movement' and support calls-to-action throughout the journey.",
      "Deployed on Render behind the official custom domain.",
    ],
    highlights: [
      "A dignified hero that states the mission in one line — 'Equal rights for every person.'",
      "Impact told in numbers: two decades of service and over a thousand verified redress cases.",
      "Light/dark theme, fast and mobile-first for a broad Kenyan audience.",
    ],
    impact: [
      { value: "20+", label: "Years of service" },
      { value: "1,101", label: "Victims verified for redress" },
      { value: "5", label: "Communities championed" },
    ],
    media: [
      {
        src: "/mockups/dennis-wamalwa.webp",
        alt: "Dr. Dennis Wamalwa — 'Equal rights for every person' campaign homepage",
      },
    ],
  },
  {
    slug: "smp-portfolio",
    title: "SMP Portfolio",
    summary:
      "This site — my own portfolio and work directory, designed and built from scratch.",
    type: "Personal",
    year: "2026",
    role: "Design & full-stack development",
    stack: ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS v4", "Vercel"],
    tags: ["Web", "Portfolio"],
    featured: false,
    cover: { from: "from-ink-600", to: "to-ink-950", initials: "SMP" },
    links: { live: "https://smp-developers.com" },
    problem:
      "I needed a portfolio that reads like a senior engineer's — a real directory of work with proper case studies, not a template.",
    approach:
      "I designed a full design system and built the site with a typed content model, a filterable work directory and per-project case studies generated statically.",
    architecture: [
      "Next.js 16 App Router, React 19, TypeScript, Tailwind v4 — static export.",
      "Typed content model: add a project by appending one object.",
      "Filterable /work directory and generated /work/[slug] case studies.",
      "SEO, Open Graph, sitemap, robots and JSON-LD; deployed on Vercel.",
    ],
    highlights: [
      "A real work directory with full case studies.",
      "One-file content model; fast, accessible, SEO-ready.",
    ],
    impact: [
      { value: "Directory", label: "Full case studies" },
      { value: "<1s", label: "Static & fast" },
    ],
    media: [{ src: "/mockups/smp-portfolio.jpg", alt: "SMP Portfolio — home" }],
  },
];

/* --------------------------- Derived helpers ---------------------------- */

export const featuredProjects = projects.filter((p) => p.featured);

export function getProject(slug: string) {
  return projects.find((p) => p.slug === slug);
}

export const projectTags = [
  "All",
  ...Array.from(new Set(projects.flatMap((p) => p.tags))),
];

/* ----------------------------- Testimonials ----------------------------- */

export type Testimonial = {
  quote: string;
  author: string;
  title: string;
  rating?: number;
  /** Optional link to the original review (Google, LinkedIn, Upwork, …). */
  link?: string;
  /** Label for the link source, e.g. "Google", "LinkedIn". */
  source?: string;
};

/**
 * Real quotes from real clients. Empty until there are some.
 *
 * WHY THIS IS EMPTY. It held one entry under the heading "What clients say",
 * five stars, attributed to "Why clients choose SMP" — marketing copy about
 * myself in the shape of a review. Anyone who reads the attribution line sees
 * that, and then has reason to doubt the screenshots too, which are the one
 * thing on this site that cannot be faked. A page with no testimonials makes
 * no claim; a page with an invented one makes a claim it cannot support.
 *
 * The home page renders this section only when the array is non-empty, so
 * adding a genuine quote here brings it back with nothing else to change.
 * What each one needs: the quote as they said it, their name, their role and
 * organisation, and ideally a `link` to where it is published (Google,
 * LinkedIn, Upwork) so it can be checked.
 */
export const testimonials: Testimonial[] = [];

/* ------------------------------- Services ------------------------------- */

export type Service = {
  /** Key into the icon map (see components/icons.tsx). */
  icon: string;
  title: string;
  blurb: string;
  /**
   * The `/work` filter pill that holds the proof for this service, when one
   * exists. `serviceHref` turns it into a link.
   *
   * Five of the six cards used to point at an unfiltered `/work`. Clicking
   * "Fintech & M-Pesa" and landing on the same fifteen projects as clicking
   * "Custom websites" makes the section decorative: it asks the visitor to do
   * the sorting it just promised to do for them.
   */
  tag?: string;
  /** Where the card points when there is no tag to filter on. */
  href?: string;
};

/** Where a service card goes: its filtered work view, or its fallback. */
export function serviceHref(service: Service): string {
  // Trailing slash: this is a static export, so /work is a directory and
  // /work?tag=… would redirect through /work/ and drop nothing, but the
  // redirect costs a round trip on the one site arguing that it is fast.
  return service.tag
    ? `/work/?tag=${encodeURIComponent(service.tag)}`
    : (service.href ?? "/contact");
}

/** How many projects on this site back a service up. 0 means none yet. */
export function serviceProofCount(service: Service): number {
  return service.tag
    ? projects.filter((p) => p.tags.includes(service.tag!)).length
    : 0;
}

/**
 * What SMP does — the capability set shown in the "Services" mega menu.
 * These are the offers, distinct from `projects` (the proof).
 */
export const services: Service[] = [
  {
    icon: "server",
    title: "Web apps & internal systems",
    blurb: "ERP, microfinance, admin dashboards — the software your organisation runs on.",
    tag: "Web App",
  },
  {
    icon: "layout",
    title: "Custom websites",
    blurb: "Fast, modern sites for business, NGO, political & personal brands.",
    tag: "Web",
  },
  {
    icon: "receipt",
    title: "Fintech & M-Pesa",
    blurb: "SACCO systems, payments, savings & investment tools with M-Pesa built in.",
    tag: "Fintech",
  },
  {
    icon: "chart",
    title: "SaaS & dashboards",
    blurb: "Multi-tenant products and data dashboards, built to scale — like StackUp.",
    tag: "SaaS",
  },
  {
    icon: "clipboard",
    title: "Inventory & point of sale",
    blurb: "Stock, tills, receipts and what is still owed — a shop's day, on one screen.",
    tag: "POS",
  },
  {
    // No tag: there is no e-learning or mobile build written up here yet, so
    // this card goes to the contact page rather than to a filter that would
    // return an empty grid. The work is real — e-Learners Academy is on the
    // client wall — but until it has a case study the honest destination is a
    // conversation, and the card says as much.
    icon: "cap",
    title: "E-learning, mobile & consulting",
    blurb: "Learning platforms, Android & iOS apps, and technology strategy from idea to launch.",
    href: "/contact",
  },
];

/* -------------------------------- Nav ----------------------------------- */

export const nav = [
  { href: "/", label: "Home" },
  { href: "/work", label: "Work" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

/* ------------------------------- Site meta ------------------------------ */

export const site = {
  domain: "smp-developers.com",
  title: `${profile.name} (SMP) — ${profile.role}`,
  description: profile.valueProp,
} as const;

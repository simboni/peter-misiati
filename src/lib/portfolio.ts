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
  /** The 5-second value proposition. */
  valueProp:
    "I'm a software engineer, social entrepreneur and tech consultant building software that drives real impact — microfinance systems, ERP platforms, e-learning tools and modern websites — while empowering youth through technology and financial education.",
  /** A slightly longer hero support line. */
  tagline:
    "Software engineer and tech consultant from Kenya. I design and build custom software, websites and mobile apps — and help organisations put technology to work.",
  location: "Nairobi & Bungoma, Kenya",
  availability: "Available for freelance & consulting",
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
  /** Quick "by the numbers" stats. */
  stats: [
    { value: 8, suffix: "+", label: "Years in tech" },
    { value: 10, suffix: "+", label: "Projects delivered" },
    { value: 10, suffix: "+", label: "Clients served" },
    { value: 3, suffix: "", label: "Ventures led" },
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
  { name: "KeYSA — Kenya Youths Support Association", logo: "/clients/keysa.png" },
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
    stack: ["Laravel 12", "PHP 8.4", "PostgreSQL", "Redis", "Livewire", "M-Pesa"],
    tags: ["Web App", "Fintech", "Client"],
    featured: true,
    cover: { from: "from-green-700", to: "to-ink-950", initials: "64" },
    logo: "/logos/64-theatre.png",
    logoBg: "#130d0f",
    category: "Web Apps",
    links: {},
    problem:
      "64 Theatre Limited (Eldoret) needed to sell tickets online, take mobile-money payments, and check guests in reliably at the gate — even when the venue's internet drops.",
    approach:
      "I designed and built a modular Laravel platform: public event pages with M-Pesa STK checkout, signed-QR ticket delivery, a Filament admin and an offline-capable gate scanner — architected “in-house first, marketplace-ready”.",
    architecture: [
      "Laravel 12 / PHP 8.4 modular monolith on PostgreSQL 16 + Redis 7.",
      "M-Pesa Daraja STK Push checkout; Africa's Talking SMS; email delivery.",
      "HMAC-signed QR tickets, verifiable offline; double-entry ledger for every sale.",
      "Filament admin + Livewire/Tailwind PWA for buyers and the gate scanner.",
    ],
    highlights: [
      "Offline-first gate scanner — tickets verify without internet.",
      "Double-entry money ledger; every ticket redeems exactly once (DB-enforced).",
      "End-to-end M-Pesa mobile-money checkout.",
    ],
    impact: [
      { value: "M-Pesa", label: "Mobile-money checkout" },
      { value: "Offline", label: "Gate scanner" },
      { value: "Ledger", label: "Double-entry money" },
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
      "A bold personal-brand site for a professional Master of Ceremonies, facilitator and moderator in Nairobi — turning 'I hold the room' into booked events across East Africa.",
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

export const testimonials: Testimonial[] = [
  {
    quote:
      "Choose SMP for dedication to delivering innovative, tailored solutions that meet your unique needs. With expertise in software development, tech consulting and youth empowerment, he brings a proven track record of impactful results.",
    author: "Why clients choose SMP",
    title: "Software development · Tech consulting · Community impact",
    rating: 5,
    // link: "https://…",  // add a Google/LinkedIn review URL to make the card clickable
    // source: "Google",
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

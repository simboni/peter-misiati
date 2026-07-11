/* ==========================================================================
   Canossian Sisters — North East Africa Province
   Single source of truth for site content.

   Edit anything here — copy, a ministry, a cause, a stat, a FAQ — and it
   flows through every page (home, about, /ministries, /ministries/[slug],
   causes, contact) plus the sitemap. You never touch the page components.
   ========================================================================== */

export const site = {
  name: "Canossian Daughters of Charity",
  shortName: "Canossian Sisters",
  province: "North East Africa Province",
  title: "Canossian Sisters — Daughters of Charity, Servants of the Poor",
  description:
    "The Canossian Daughters of Charity (Canossian Sisters) serve the poor, needy and marginalized across Tanzania, Kenya, Uganda and Sudan through education, evangelization, pastoral healthcare, formation of the laity, and spiritual retreats.",
  // Update to the live domain before launch — drives canonical URLs & sitemap.
  domain: "canossiansistersneafrica.org",
} as const;

export const contact = {
  phone: "+254 790 804 505",
  phoneHref: "tel:+254790804505",
  email: "info@canossiansistersneafrica.org",
  address: {
    org: "Canossian Daughters of Charity",
    lines: ["Provincial House", "P.O. Box 7683", "Upanga – Dar es Salaam", "Tanzania"],
  },
  socials: {
    facebook: "https://www.facebook.com/",
    instagram: "https://www.instagram.com/",
    youtube: "https://www.youtube.com/",
  },
} as const;

export const nav = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Ministries", href: "/ministries" },
  { label: "Causes", href: "/causes" },
  { label: "Gallery", href: "/gallery" },
  { label: "Contact", href: "/contact" },
] as const;

export const identity = {
  vision:
    "To be Women of the Word — loving without measure, reconfigured to a life of holiness in and for the mission of today.",
  mission:
    "We dedicate ourselves to serve the poor, needy and the marginalized through our five ministries.",
  charism:
    "Founded by St Magdalene of Canossa in 1808, the Canossian Daughters of Charity live the charity of the Crucified Christ — making Him known and loved, especially among the little ones and the poor.",
  motto: "Caritas Christi Urget Nos — The love of Christ impels us.",
} as const;

export const founder = {
  name: "St Magdalene of Canossa",
  years: "1774 – 1835",
  founded: 1808,
  anniversary: "250th Birth Anniversary",
  blurb:
    "A noblewoman of Verona who left privilege to serve the poor, Magdalene founded the Canossian Daughters of Charity to bring the love of the Crucified Christ to the abandoned, the sick, and the young. The Church celebrates the 250th anniversary of her birth.",
  quotes: [
    "The behaviour of a person in life depends on the education received.",
    "There is no act of charity as perfect as that of helping our neighbour to love God.",
    "Make Jesus known and loved.",
  ],
} as const;

/* ------------------------------- Ministries ------------------------------ */
/* The five ministries through which the Sisters serve the Province.        */

export type Ministry = {
  slug: string;
  name: string;
  tagline: string;
  summary: string;
  body: string[];
  quote?: { text: string; by?: string };
  image: string;
  gallery?: string[];
  highlights: string[];
  icon: "book" | "flame" | "heart" | "hands" | "dove";
  accent: "terra" | "gold" | "sky" | "sage";
};

export const ministries: Ministry[] = [
  {
    slug: "education",
    name: "Education",
    tagline: "Formation of the heart",
    summary:
      "We foster the holistic growth of children, adolescents and young people — forming them to be agents of change in the society they live in, according to Gospel values.",
    body: [
      "Through formal and informal educational institutions across the Province, we accompany learners toward holistic development that leads to the “formation of the heart.”",
      "We foster the growth of children, adolescents and young people to “prevent and impede sin” — forming consciences, nurturing gifts, and raising up agents of change in their communities according to Gospel values.",
      "From nursery classrooms to sponsorship and skills programmes, education is where the Canossian charism most visibly takes root in the next generation.",
    ],
    quote: {
      text: "The behaviour of a person in life depends on the education received.",
      by: "St Magdalene of Canossa",
    },
    image: "/images/education.jpg",
    gallery: ["/images/education.jpg", "/images/education-class.jpg"],
    highlights: [
      "Nursery, primary and informal schools",
      "Holistic, heart-centred formation",
      "Values-based, Gospel-rooted teaching",
      "Pathways to scholarships and sponsorship",
    ],
    icon: "book",
    accent: "terra",
  },
  {
    slug: "evangelization",
    name: "Evangelization",
    tagline: "That Christ may be the heart of the world",
    summary:
      "We expend ourselves with untiring generosity in the holy exercises of the Church so that Christ may be the heart of the world.",
    body: [
      "Faithful to the Church’s mission, we bring the Good News to parishes and communities across the Province — catechesis, sacramental preparation, youth and family ministry, and accompaniment of the faithful.",
      "We labour so that Christ may be known, loved and placed at the centre of every life we touch.",
    ],
    quote: {
      text: "There is no act of charity as perfect as that of helping our neighbour to love God.",
      by: "St Magdalene of Canossa",
    },
    image: "/images/evangelization.jpg",
    gallery: ["/images/evangelization.jpg", "/images/evangelization-bukoba.jpg"],
    highlights: [
      "Catechesis & sacramental preparation",
      "Parish and community accompaniment",
      "Youth and family ministry",
      "Mission animation across the Province",
    ],
    icon: "flame",
    accent: "gold",
  },
  {
    slug: "pastoral-healthcare",
    name: "Pastoral Healthcare",
    tagline: "The sick as living images of Christ",
    summary:
      "Faithful to the teachings of the Church, we promote the culture of life in all its stages and regard the sick as the living images of Christ Himself.",
    body: [
      "We serve in hospitals, clinics and homes — offering primary care, maternal care and compassionate presence to the suffering.",
      "We regard the sick as the living images of Christ Himself and remain “ready, if necessary, to expose our lives in the exercise of Holy Charity.”",
      "Our pastoral healthcare promotes the culture of life in all its stages and expressions.",
    ],
    quote: {
      text: "Ready, if necessary, to expose our lives in the exercise of Holy Charity.",
    },
    image: "/images/healthcare.jpg",
    gallery: ["/images/healthcare.jpg"],
    highlights: [
      "Primary & maternal healthcare",
      "Care of the sick and the dying",
      "Promotion of the culture of life",
      "Compassionate pastoral presence",
    ],
    icon: "heart",
    accent: "sky",
  },
  {
    slug: "formation-of-the-laity",
    name: "Formation of the Laity",
    tagline: "Sharing the charism",
    summary:
      "We form lay collaborators to live and share the Canossian charism — becoming, with us, servants of charity in their own homes and communities.",
    body: [
      "The mission belongs to the whole Church. We accompany lay women and men — teachers, volunteers, families and friends — in living the spirituality of St Magdalene.",
      "Through study, prayer and shared service, the laity become co-workers of charity, carrying the charism into places the Sisters alone cannot reach.",
    ],
    image: "/images/daughters.jpg",
    gallery: ["/images/daughters.jpg", "/images/church-2.jpg"],
    highlights: [
      "Formation in the Canossian charism",
      "Lay associates & volunteers",
      "Prayer and shared mission",
      "Families touched and involved",
    ],
    icon: "hands",
    accent: "sage",
  },
  {
    slug: "spiritual-exercises-retreats",
    name: "Spiritual Exercises & Retreats",
    tagline: "Rest in the Word",
    summary:
      "We offer spiritual exercises, retreats and accompaniment — spaces of silence and prayer where hearts can meet the living God.",
    body: [
      "As Women of the Word, we open our houses for retreats, days of recollection and spiritual direction.",
      "We accompany individuals and groups on the journey of interior renewal — helping them draw near to the Crucified and Risen Christ.",
    ],
    quote: {
      text: "Women of the Word, loving without measure.",
    },
    image: "/images/church-1.jpg",
    gallery: ["/images/church-1.jpg", "/images/church-2.jpg"],
    highlights: [
      "Retreats & days of recollection",
      "Spiritual direction & accompaniment",
      "Prayer and interior renewal",
      "Silence, Scripture and sacrament",
    ],
    icon: "dove",
    accent: "terra",
  },
];

export function getMinistry(slug: string) {
  return ministries.find((m) => m.slug === slug);
}

/* --------------------------------- Causes -------------------------------- */
/* Ongoing appeals the community can support.                               */

export type Cause = {
  slug: string;
  title: string;
  summary: string;
  quote?: { text: string; by?: string };
  progress: number; // 0–100
  image: string;
  accent: "terra" | "gold" | "sky" | "sage";
};

export const causes: Cause[] = [
  {
    slug: "canossa-school",
    title: "Help Build a Canossa School",
    summary:
      "Formal and informal educational institutions are being established across the region, ensuring holistic development that leads to the formation of the heart of the learners we serve.",
    quote: {
      text: "The behaviour of a person in life depends on the education received.",
      by: "St Magdalene of Canossa",
    },
    progress: 68,
    image: "/images/education-class.jpg",
    accent: "terra",
  },
  {
    slug: "scholarships",
    title: "Scholarships & Sponsorship Programs",
    summary:
      "We provide scholarships and sponsorship programs to support students on their educational journey, partnering with local communities and organizations to identify and support deserving learners.",
    progress: 55,
    image: "/images/education.jpg",
    accent: "gold",
  },
  {
    slug: "canossa-hospital",
    title: "Canossa Hospital in Tanzania",
    summary:
      "Our hospital in Tanzania provides primary care, maternal care, surgical procedures and specialized treatment — equipped with modern machinery and dedicated staff to ensure optimum delivery of care.",
    progress: 30,
    image: "/images/healthcare.jpg",
    accent: "sky",
  },
];

/* --------------------------------- Impact -------------------------------- */

export const stats = [
  { value: 100000, suffix: "+", label: "Lives touched", note: "Vulnerable, poor and at-risk families across North & East Africa" },
  { value: 4, suffix: "", label: "Countries served", note: "Tanzania · Kenya · Uganda · Sudan" },
  { value: 5, suffix: "", label: "Ministries", note: "One mission of charity, lived five ways" },
  { value: 1808, suffix: "", label: "Serving since", note: "Founded by St Magdalene of Canossa" },
] as const;

export const locations = [
  { country: "Tanzania", note: "Provincial House · Dar es Salaam" },
  { country: "Kenya", note: "Communities & apostolates" },
  { country: "Uganda", note: "Communities & apostolates" },
  { country: "Sudan", note: "Communities & apostolates" },
] as const;

/* ---------------------------------- FAQ ---------------------------------- */

export const faqs = [
  {
    q: "Which countries do you serve in the region?",
    a: "Our North East Africa Province covers four countries: Tanzania, Kenya, Uganda and Sudan.",
  },
  {
    q: "What motivates your charity?",
    a: "We are called to serve the poor and vulnerable. Rooted in the charism of St Magdalene of Canossa, our ministry seeks to improve lives across the Province through education, evangelization and healthcare.",
  },
  {
    q: "How can I volunteer with the Sisters?",
    a: "You can reach out to us through our email and social media, or visit our Contact page. We welcome volunteers who wish to share in the mission of charity.",
  },
  {
    q: "How can I support a cause or make a gift?",
    a: "Visit our Causes page to see the appeals you can support — from building schools to scholarships and the Canossa Hospital — then contact us to arrange your gift.",
  },
] as const;

/* -------------------------------- Updates -------------------------------- */
/* Recent news for the home page (replaces the old blog).                   */

export const updates = [
  {
    title: "Celebrating the 250th Birth Anniversary of St Magdalene of Canossa",
    date: "2026-05-08",
    excerpt:
      "The Province joins the worldwide Canossian family in thanksgiving for 250 years since the birth of our foundress — a jubilee of charity, gratitude and renewed mission.",
    image: "/images/church-2.jpg",
  },
  {
    title: "New classrooms welcome learners at Canossa, Tegeta",
    date: "2026-03-14",
    excerpt:
      "Our early-years and primary programmes continue to grow, forming the hearts of the youngest learners we serve through values-based education.",
    image: "/images/education.jpg",
  },
  {
    title: "Sisters gather in Arusha for provincial retreat",
    date: "2026-02-02",
    excerpt:
      "Days of silence, Scripture and shared prayer renewed the Sisters of the North East Africa Province for the mission of today.",
    image: "/images/sisters-arusha.jpg",
  },
] as const;

/* ------------------------------- Testimonial ----------------------------- */

export const testimonial = {
  quote:
    "Our charity has touched and changed the lives of over 100,000 vulnerable, poor and at-risk families across North and East Africa.",
  by: "Canossian Daughters of Charity",
  role: "North East Africa Province",
} as const;

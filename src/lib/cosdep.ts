/* ==========================================================================
   COSDEP — single source of content
   --------------------------------------------------------------------------
   Everything the site renders — the mission, the programmes, the projects,
   the figures, the testimonials and the contact details — lives in this one
   typed file. Edit here and every page, card and menu updates itself.
   ========================================================================== */

/* --------------------------------- Site --------------------------------- */

export const site = {
  name: "COSDEP",
  fullName: "Community Sustainable Development Empowerment Programme",
  domain: "cosdepkenya.org",
  title: "COSDEP — Training farmers to secure their future",
  description:
    "COSDEP is a registered Kenyan NGO advancing agro-ecological agriculture, natural-resource management and value addition — improving food security and livelihoods for smallholder farmers in rural communities.",
  tagline: "Training farmers to secure their future",
  established: 2004,
} as const;

/* ------------------------------- Identity ------------------------------- */

export const org = {
  welcome: "Welcome to COSDEP",
  headline: "Training farmers to secure their future",
  intro:
    "Community Sustainable Development Empowerment Programme (COSDEP) is a registered non-governmental organization that focuses on the continued learning and practice of agro-ecological agriculture in rural communities for improved food and dietary conditions. Community-development programmes in other fields have been just as central to our mission of transforming the livelihoods of vulnerable communities.",
  mission:
    "To empower rural communities to practise sustainable, agro-ecological agriculture that secures food and nutrition, restores natural resources and builds lasting household income.",
  vision:
    "Resilient, food-secure rural communities that farm in harmony with nature and shape their own future.",
  approach: [
    {
      title: "We train, then we stay",
      body: "Hands-on training in ecological farming and integrated pest management is only the beginning — we keep checking on farmers' progress and introduce new ideas long after the first workshop ends.",
    },
    {
      title: "We grow from the soil up",
      body: "From kitchen gardens to school gardens to demonstration farms, we start with what a household already has and build organic, chemical-free food production around it.",
    },
    {
      title: "We restore the land",
      body: "Tree planting, agroforestry and watershed rehabilitation put forest cover back on the hills and water back in the wetlands that farming communities depend on.",
    },
    {
      title: "We turn harvests into income",
      body: "Value addition, bio-inputs and market linkages help smallholder farmers earn a steady income from safe, organic produce grown on their own land.",
    },
  ],
} as const;

/* --------------------------------- Figures ------------------------------ */

export type Figure = { value: number; suffix: string; label: string };

export const figures: Figure[] = [
  { value: 6000, suffix: "+", label: "Direct farmers reached" },
  { value: 10000, suffix: "+", label: "Trees planted" },
  { value: 30, suffix: "+", label: "School gardens established" },
];

/* -------------------------------- Programmes ---------------------------- */
/* The three thematic pillars every project rolls up into. */

export type Program = {
  slug: string;
  title: string;
  tagline: string;
  summary: string;
  image: string;
  imageAlt: string;
  activities: string[];
};

export const programs: Program[] = [
  {
    slug: "food-and-nutrition-security",
    title: "Food & Nutrition Security",
    tagline: "Growing safe, healthy food at home",
    summary:
      "We help households and schools grow their own chemical-free food using agro-ecological methods — kitchen gardens, sack and vertical gardens, integrated pest management and composting — so families eat safe, diverse and nutritious meals all year round.",
    image: "/images/kitchen-garden.jpg",
    imageAlt:
      "Farmers touring a demonstration plot of tiered vertical gardens and vegetable beds",
    activities: [
      "Agro-ecological farmer training",
      "Kitchen, sack & vertical gardens",
      "School gardening & life skills",
      "Integrated pest management",
      "Composting & soil health",
    ],
  },
  {
    slug: "natural-resource-management",
    title: "Natural Resource Management",
    tagline: "Restoring forests, water & soil",
    summary:
      "Working with communities, we increase forest cover through tree planting and agroforestry, rehabilitate wetlands and protect watersheds — building climate resilience on the very hills and rivers that farming depends on.",
    image: "/images/community-tree-planting.jpg",
    imageAlt:
      "Community members planting tree seedlings across a reforested hillside",
    activities: [
      "Tree planting & agroforestry",
      "Watershed & wetland rehabilitation",
      "Climate-resilience advocacy",
      "Tree-management training",
      "School tree-planting drives",
    ],
  },
  {
    slug: "value-addition-and-entrepreneurship",
    title: "Value Addition & Entrepreneurship",
    tagline: "Turning harvests into household income",
    summary:
      "Smallholder farmers add value to their organic produce — from sweet-potato, arrow-root and cassava flours to bio-inputs — and reach buyers through market outlets and integrated marketing, earning a steady income from what they grow.",
    image: "/images/value-added-products.jpg",
    imageAlt:
      "COSDEP exhibition stand displaying value-added organic flours and produce",
    activities: [
      "Value-added organic products",
      "Local market outlets & linkages",
      "Making of bio-inputs",
      "Youth & farmer entrepreneurship",
      "Income-generation support",
    ],
  },
];

/* --------------------------------- Projects ----------------------------- */

export type Project = {
  slug: string;
  title: string;
  program: string; // program slug
  status: "Ongoing" | "Upcoming" | "Completed";
  location: string;
  summary: string;
  image: string;
  imageAlt: string;
  featured?: boolean;
};

export const projects: Project[] = [
  {
    slug: "watershed-tree-planting-kiambu-muranga",
    title:
      "Enhancing Watershed Conservation & Climate Resilience through Tree Planting",
    program: "natural-resource-management",
    status: "Upcoming",
    location: "Kiambu & Murang'a Counties",
    summary:
      "A proposed programme to restore critical watersheds and build climate resilience by planting trees with communities across Kiambu and Murang'a — increasing forest cover where rivers and farms need it most.",
    image: "/images/community-tree-planting.jpg",
    imageAlt: "Community members planting trees on a hillside",
    featured: true,
  },
  {
    slug: "integrated-marketing-organic-products-kiambu",
    title: "Integrated Marketing for Organic Products in Kiambu County",
    program: "value-addition-and-entrepreneurship",
    status: "Ongoing",
    location: "Kiambu County",
    summary:
      "Connecting smallholder farmers to reliable buyers through integrated marketing — building demand for safe, organic produce and value-added products so farming families earn a fair, steady income.",
    image: "/images/value-added-products.jpg",
    imageAlt: "Value-added organic flours and produce on a COSDEP stand",
    featured: true,
  },
  {
    slug: "organic-produce-market-outlet-githunguri",
    title:
      "Establishment & Promotion of a Local Organic Produce Market Outlet in Githunguri",
    program: "value-addition-and-entrepreneurship",
    status: "Ongoing",
    location: "Githunguri, Kiambu County",
    summary:
      "Setting up a dedicated market outlet where the community can buy trusted, locally grown organic produce — giving farmers a stable route to market and shoppers a source of safe, healthy food.",
    image: "/images/farmers-vegetables.jpg",
    imageAlt: "Women farmers tending a plot of organic leafy vegetables",
    featured: true,
  },
  {
    slug: "promote-agroecology-kiambu",
    title: "Promote Agroecology & Sustainable Practices in Kiambu",
    program: "food-and-nutrition-security",
    status: "Ongoing",
    location: "Kiambu County",
    summary:
      "Scaling agro-ecological practice across Kiambu through farmer training, demonstration plots and continued mentorship — so more households grow safe, diverse food while caring for their soil.",
    image: "/images/kitchen-garden.jpg",
    imageAlt: "Demonstration plot of vertical gardens and vegetable beds",
  },
  {
    slug: "aberdare-watershed-management",
    title: "Aberdare Watershed Management Programme",
    program: "natural-resource-management",
    status: "Ongoing",
    location: "Aberdare Range",
    summary:
      "Protecting the Aberdare watershed through agroforestry, reforestation and community advocacy — safeguarding the forests and rivers that sustain agriculture across the wider region.",
    image: "/images/agroforestry.jpg",
    imageAlt: "Agroforestry plot with tall trees intercropped with crops",
  },
  {
    slug: "agroecology-fund-project",
    title: "Agroecology Fund Project",
    program: "food-and-nutrition-security",
    status: "Ongoing",
    location: "Kiambu County",
    summary:
      "A programme strengthening food and nutrition security through agro-ecology — supporting farmers to grow nutritious food sustainably and share knowledge across their communities.",
    image: "/images/community-training.jpg",
    imageAlt: "Farmers gathered for an outdoor community training session",
  },
];

/* ------------------------------ Testimonials ---------------------------- */

export type Testimonial = {
  name: string;
  role: string;
  quote: string;
};

export const testimonials: Testimonial[] = [
  {
    name: "Hannah",
    role: "Farmer",
    quote:
      "I'm so happy with the changes in my farming. I now grow fresh vegetables without chemicals, and my family enjoys safe, healthy food. With the new techniques I've learned, farming has become easier and more productive. I feel proud and hopeful for the future.",
  },
  {
    name: "Jane",
    role: "Farmer",
    quote:
      "Through COSDEP's kitchen-farming project I have learned ecological farming and integrated pest management. The training has helped me earn a weekly income from my small farm, which supports my family. What I appreciate most is that COSDEP did not abandon us after training — they keep checking on our progress and introducing new ideas. This has given me confidence and hope for a better future.",
  },
];

/* -------------------------------- Gallery ------------------------------- */
/* "COSDEP in Action" — real photographs from the field. */

export type GalleryItem = { src: string; alt: string };

export const gallery: GalleryItem[] = [
  {
    src: "/images/school-tree-planting.jpg",
    alt: "A COSDEP officer handing tree seedlings to schoolchildren in uniform",
  },
  {
    src: "/images/farmers-vegetables.jpg",
    alt: "Women farmers tending a plot of organic leafy greens",
  },
  {
    src: "/images/tree-management-training.jpg",
    alt: "A farmer group at a tree-management-techniques training",
  },
  {
    src: "/images/kitchen-garden.jpg",
    alt: "Farmers touring a demonstration of tiered vertical gardens",
  },
  {
    src: "/images/community-training.jpg",
    alt: "An outdoor community training session with women farmers",
  },
  {
    src: "/images/team-partners.jpg",
    alt: "The COSDEP team with partners in a garden",
  },
];

/* -------------------------------- Involve ------------------------------- */

export const involve = [
  {
    title: "Donate",
    body: "Every contribution funds seedlings, training and tools that put safe food on rural tables and forests back on the hills.",
    href: "/get-involved#donate",
    cta: "Donate now",
  },
  {
    title: "Volunteer",
    body: "Share your skills in the field, in schools or behind the scenes. Volunteers help our programmes reach further.",
    href: "/get-involved#volunteer",
    cta: "Become a volunteer",
  },
  {
    title: "Partner with us",
    body: "Foundations, agencies and businesses partner with COSDEP to co-create lasting impact for smallholder farmers.",
    href: "/get-involved#partner",
    cta: "Explore partnership",
  },
] as const;

/* -------------------------------- Donation ------------------------------ */

export const donation = {
  intro:
    "COSDEP is a registered non-governmental organization. Your gift directly funds tree seedlings, farmer training, school gardens and the tools rural families need to grow safe, healthy food.",
  bank: {
    bankName: "Co-operative Bank of Kenya",
    branch: "Stima Plaza Branch",
    branchCode: "11035",
    accountName: "Community Sustainable Development Empowerment Programme",
    accountNumber: "01100069964500",
    swift: "KCOOKENA",
  },
} as const;

/* -------------------------------- Contact ------------------------------- */

export const contact = {
  email: "info@cosdepkenya.org",
  phone: "+254 20 712 1685",
  phoneDisplay: "020 712 1685",
  poBox: "P.O. Box 132-00621, Village Market, Nairobi",
  location: "Kiambu County, Kenya",
  socials: {
    facebook: "https://www.facebook.com/",
    twitter: "https://twitter.com/",
    youtube: "https://www.youtube.com/",
    instagram: "https://www.instagram.com/",
    linkedin: "https://www.linkedin.com/",
  },
} as const;

/* ------------------------------ Navigation ------------------------------ */

export const nav = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/programs", label: "Programmes" },
  { href: "/projects", label: "Projects" },
  { href: "/get-involved", label: "Get Involved" },
  { href: "/contact", label: "Contact" },
] as const;

/* Hero slides — each maps a programme pillar to a field photograph. */

export const heroSlides = [
  {
    kicker: "Food & Nutrition Security",
    title: "Safe, healthy food grown at home",
    body: "Mentoring families and schoolchildren to grow organic food in kitchen and school gardens.",
    image: "/images/farmers-vegetables.jpg",
    alt: "Women farmers tending organic leafy vegetables",
  },
  {
    kicker: "Natural Resource Management",
    title: "Putting forests back on the hills",
    body: "Rehabilitating watersheds and wetlands by increasing forest cover through community tree planting.",
    image: "/images/community-tree-planting.jpg",
    alt: "Community members planting trees on a hillside",
  },
  {
    kicker: "Value Addition & Entrepreneurship",
    title: "Turning harvests into income",
    body: "Smallholder farmers add value to organic produce and reach markets — building lasting household income.",
    image: "/images/value-added-products.jpg",
    alt: "COSDEP stand of value-added organic products",
  },
  {
    kicker: "School Gardening & Life Skills",
    title: "Growing the next generation of farmers",
    body: "Schoolchildren learn organic gardening and life skills through hands-on tree planting and gardens.",
    image: "/images/school-tree-planting.jpg",
    alt: "COSDEP officer handing seedlings to schoolchildren",
  },
] as const;

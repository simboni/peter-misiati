/* --------------------------------------------------------------------------
   KEYSA — Kenya Youth Support Association
   Single source of truth for every page. All copy is distilled from the
   organisation's registration records, background papers, and project
   proposals; edit here and the whole site updates.
--------------------------------------------------------------------------- */

export const site = {
  name: "Kenya Youth Support Association",
  shortName: "KEYSA",
  domain: "www.keysa.org",
  url: "https://www.keysa.org",
  title: "KEYSA — Kenya Youth Support Association",
  description:
    "KEYSA empowers young people in Kakamega County, Kenya through education, sports and talents, technology, financial literacy and community development — cultivating confident, competent and compassionate leaders of tomorrow.",
  email: "info@keysa.org",
  location: "Namamali Ward, Matungu Constituency, Kakamega County, Kenya",
  founded: 2020,
  registered: 2023,
  facebook: "https://www.facebook.com/profile.php?id=61583833030180",
};

export const identity = {
  vision:
    "To unlock the full potential of every young person by equipping them with the tools necessary to be confident, competent, and compassionate leaders of tomorrow.",
  mission:
    "To empower youth by providing them with opportunities and resources in education, sports, technology and financial literacy.",
  /** The founding commitment statement, used as supporting copy. */
  commitment:
    "To cultivate and empower young people, fostering sustainable and self-reliant communities through a focus on leadership, mentorship, and community engagement.",
  objectives: [
    "To provide youth with the knowledge, skills and values necessary to lead productive and fulfilling lives.",
    "To enable youth to unlock their full potential — empowering them with the opportunities and support they need to thrive, benefiting both the individual and society as a whole.",
    "To equip youth with technology skills that build employability, economic growth, digital inclusion, critical thinking and problem-solving — and responsible digital citizenship.",
    "To equip youth with financial literacy that builds a strong foundation, promotes financial responsibility, fosters independence, encourages entrepreneurship and innovation, mitigates financial risks and bridges socio-economic gaps.",
    "To encourage youth to become active in community development programs through participation — fostering growth, building capacity to contribute to community well-being, and taking charge of sustainable development.",
  ],
};

export type CoreValue = {
  name: string;
  description: string;
  icon: "flag" | "handshake" | "compass" | "scale" | "globe";
};

export const coreValues: CoreValue[] = [
  {
    name: "Empowerment & Leadership",
    icon: "flag",
    description:
      "We give young people real responsibility and the room to grow into it — encouraging them to be proactive and influential in shaping their own future.",
  },
  {
    name: "Partnerships",
    icon: "handshake",
    description:
      "We collaborate with like-minded organisations, leveraging collective expertise and resources to meet the real needs of the youth we serve.",
  },
  {
    name: "Mentorship & Guidance",
    icon: "compass",
    description:
      "We connect experienced professionals with vulnerable young people, providing the guidance, support and inspiration that changes trajectories.",
  },
  {
    name: "Inclusivity & Equal Opportunities",
    icon: "scale",
    description:
      "Every young person — regardless of background, family or status — gets an equal chance. We eliminate barriers so all youth can benefit from our programs.",
  },
  {
    name: "Community Engagement",
    icon: "globe",
    description:
      "We engage youth in development initiatives and volunteer activities, fostering empathy, social responsibility and a sense of belonging by giving back.",
  },
];

/* ------------------------------------------------------------------ */
/* Programs — the five thematic areas                                  */
/* ------------------------------------------------------------------ */

export type Program = {
  slug: string;
  name: string;
  short: string;
  tagline: string;
  icon: "book" | "trophy" | "chip" | "coins" | "hands";
  summary: string;
  description: string[];
  activities: string[];
  outcomes: string[];
};

export const programs: Program[] = [
  {
    slug: "education",
    name: "Education & Scholarships",
    short: "Education",
    tagline: "Keeping vulnerable youth learning",
    icon: "book",
    summary:
      "We sponsor vulnerable students by covering their school necessities and prioritise access to Technical and Vocational Education and Training (TVET), giving young people the educational foundation they need to succeed.",
    description: [
      "Education sits at the heart of everything KEYSA does. Many young people in Namamali Ward and across Kakamega County are locked out of learning not by ability, but by circumstance — school fees, learning materials, family hardship, or the stigma that follows a teenage pregnancy.",
      "We sponsor students by covering their school necessities, and we place special emphasis on Technical and Vocational Education and Training (TVET): practical, marketable skills that lead directly to employment or self-employment. For young mothers and school-leavers, TVET is often the fastest, most dignified route back into education and towards independence.",
      "Beyond fees and materials, we surround every learner with mentorship, counselling and life-skills workshops — because staying in education is as much about support as it is about money.",
    ],
    activities: [
      "Sponsorship of school necessities for vulnerable students",
      "Placement and tuition support in accredited TVET institutions",
      "Community outreach to identify out-of-school youth",
      "Counselling and reintegration support for young mothers",
      "Life-skills, leadership and personal development workshops",
    ],
    outcomes: [
      "Vulnerable youth back in classrooms and workshops",
      "Marketable skills leading to jobs and businesses",
      "Reduced stigma around girls' education",
    ],
  },
  {
    slug: "sports-and-talents",
    name: "Sports & Talents",
    short: "Sports & Talents",
    tagline: "A platform for every gift",
    icon: "trophy",
    summary:
      "From football pitches to performance stages, we identify, nurture and train young athletes, artists, comedians and creatives — building discipline, confidence and real pathways to opportunity.",
    description: [
      "Sports and creative talents play a critical role in the holistic development of young people — building physical well-being, teamwork, discipline and self-confidence. Yet many youth in our community lack the equipment, facilities, coaching and mentorship to develop what they're naturally good at.",
      "KEYSA provides that platform. We organise structured training in football, volleyball and athletics with professional coaches, and run music, drama and art workshops with local artists and instructors. Talent competitions, performances and exhibitions give young people the stage to be seen — by their community, and by scouts, sponsors and professional networks.",
      "We deliberately design for inclusivity: girls participate equally in every discipline, challenging cultural norms that too often keep them on the sidelines.",
    ],
    activities: [
      "Weekly football, volleyball and athletics training with professional coaches",
      "Music, drama and art workshops with local artists",
      "Inter-ward tournaments, talent shows and art exhibitions",
      "Mentorship on personal branding, discipline and career paths",
      "Provision of sports equipment, kits and materials",
    ],
    outcomes: [
      "Structured pathways from raw talent to scholarships and careers",
      "Equal participation of girls in sports and the arts",
      "Reduced idleness, drug abuse and early pregnancies",
    ],
  },
  {
    slug: "technology",
    name: "Technology & Digital Skills",
    short: "Technology",
    tagline: "Skills for the digital economy",
    icon: "chip",
    summary:
      "We train young people in tech-related courses and follow through with direct employment opportunities — empowering youth to earn and thrive in the digital economy.",
    description: [
      "The digital economy is creating opportunities that don't depend on where you were born — but only for those with the skills to seize them. KEYSA offers training in a range of tech-related courses, from digital literacy foundations upwards.",
      "What makes our approach different is the follow-through: training is paired with direct employment opportunities, so skills translate into income. For rural youth in Kakamega County, that link between learning and earning is what turns a course certificate into a changed life.",
    ],
    activities: [
      "Training in tech-related courses and digital literacy",
      "Direct employment linkage after training",
      "Mentorship from professionals in the technology sector",
    ],
    outcomes: [
      "Youth earning in the digital economy",
      "A growing local pool of digital talent",
    ],
  },
  {
    slug: "financial-literacy",
    name: "Financial Literacy",
    short: "Financial Literacy",
    tagline: "The foundations of self-reliance",
    icon: "coins",
    summary:
      "We teach young people the basics of financial management — budgeting, saving, and enterprise — so they are prepared for financial independence and self-reliance.",
    description: [
      "Income without financial skills rarely becomes independence. Across all our programs, KEYSA teaches young people the basics of financial management: budgeting, saving, record-keeping and the fundamentals of running a small enterprise.",
      "For graduates of our training programs who want to start businesses, we work towards a revolving fund offering microloans, paired with business training and mentorship — creating a sustainable cycle where today's beneficiaries become tomorrow's employers and mentors.",
    ],
    activities: [
      "Financial management basics for all program participants",
      "Business training for young entrepreneurs",
      "Microloan support through a planned revolving fund",
      "Ongoing mentorship for youth-run enterprises",
    ],
    outcomes: [
      "Financially independent young people",
      "Youth-owned businesses employing their peers",
    ],
  },
  {
    slug: "community-development",
    name: "Community Development & Climate Action",
    short: "Community",
    tagline: "Youth giving back, communities rising",
    icon: "hands",
    summary:
      "We mobilise young people to give back through campaigns, volunteer activities and climate action — from tree planting to climate-smart agriculture — building resilient, self-reliant communities.",
    description: [
      "KEYSA believes empowered youth become empowering citizens. We encourage young people to give back to their communities through campaigns and volunteer activities that foster empathy, social responsibility and a sense of belonging.",
      "Climate action is a growing pillar of this work. Namamali Ward depends on agriculture, and erratic weather, droughts and floods hit hardest here. We train youth in climate-smart agriculture, water conservation and renewable energy; run reforestation campaigns with a goal of 100,000 indigenous and fruit trees; and support youth-led green enterprises — turning environmental stewardship into livelihoods.",
      "We also protect the most vulnerable: our community sensitisation work raises awareness of human trafficking, child labour and exploitation, in partnership with local leaders, law enforcement and human rights organisations.",
    ],
    activities: [
      "Volunteer campaigns and community service days",
      "Tree planting, community nurseries and 'Adopt-a-Tree' initiatives",
      "Climate-smart agriculture training and demonstration farms",
      "Biogas and renewable energy training",
      "Anti-trafficking awareness and child-protection sensitisation",
    ],
    outcomes: [
      "A greener, more climate-resilient ward",
      "Green jobs and youth-led cooperatives",
      "Communities alert to trafficking and exploitation risks",
    ],
  },
];

export function getProgram(slug: string) {
  return programs.find((p) => p.slug === slug);
}

/* ------------------------------------------------------------------ */
/* Projects — concrete, fundable initiatives                           */
/* ------------------------------------------------------------------ */

export type ProjectStat = { value: string; label: string };

export type Project = {
  slug: string;
  title: string;
  subtitle: string;
  status: "Seeking funding" | "Ongoing" | "Completed";
  duration: string;
  location: string;
  programSlug: string;
  targetGroup: string;
  stats: ProjectStat[];
  summary: string;
  background: string[];
  objectives: string[];
  activities: { title: string; detail: string }[];
  outcomes: string[];
  sustainability?: string[];
  budgetNote?: string;
};

export const projects: Project[] = [
  {
    slug: "transformative-education",
    title: "Youth Uplifting & Transformative Education",
    subtitle: "TVET access for 100 vulnerable youth",
    status: "Seeking funding",
    duration: "2 years",
    location: "Namamali Ward, Matungu Constituency, Kakamega County",
    programSlug: "education",
    targetGroup: "Vulnerable youth — young mothers and out-of-school boys",
    stats: [
      { value: "100", label: "youth enrolled in TVET" },
      { value: "2", label: "year program" },
      { value: "5", label: "support pillars" },
    ],
    summary:
      "Facilitating access to Technical and Vocational Education and Training for 100 vulnerable young people — particularly girls affected by pregnancies during COVID-19 school closures and boys forced out of education by economic hardship — while confronting the human trafficking that preys on them.",
    background: [
      "The COVID-19 pandemic devastated the youth of Namamali Ward. Prolonged school closures led to a significant rise in unwanted pregnancies among girls, many of whom were abandoned by their families due to cultural stigma. At the same time, many boys dropped out of school to take on odd jobs after their parents lost work in the economic downturn.",
      "This has left both girls and boys dangerously exposed to exploitation — traffickers lure vulnerable youth into child labour, domestic servitude and drug peddling.",
      "TVET offers a practical answer: marketable skills that lead to gainful employment or entrepreneurship. But financial constraints, low awareness and cultural barriers keep it out of reach. This project bridges that gap.",
    ],
    objectives: [
      "Facilitate access to TVET education for 100 vulnerable youth over two years",
      "Equip youth with marketable skills for employment and enterprise",
      "Address cultural stigmas around teenage pregnancy and empower young mothers",
      "Protect youth from trafficking through awareness and safe alternatives",
      "Provide mentorship for holistic development during and after training",
      "Promote sustainable livelihoods through skills and financial literacy",
    ],
    activities: [
      {
        title: "Identification & selection",
        detail:
          "Community outreach to identify the most affected youth, with transparent selection criteria developed alongside local leaders, schools and community organisations.",
      },
      {
        title: "TVET enrollment",
        detail:
          "Placements in accredited TVET institutions across Kakamega County — tuition fees, learning materials, and accommodation support where needed.",
      },
      {
        title: "Mentorship & counselling",
        detail:
          "Ongoing guidance for every beneficiary, with dedicated counselling for young mothers and workshops on life skills, leadership and personal development.",
      },
      {
        title: "Stigma & anti-trafficking work",
        detail:
          "Community dialogues with parents and elders to reintegrate young mothers into education, plus sensitisation on recognising and avoiding trafficking recruitment tactics — in partnership with law enforcement and human rights organisations.",
      },
      {
        title: "Monitoring & evaluation",
        detail:
          "Regular institutional visits, quarterly stakeholder reviews, and community monitoring for trafficking activity.",
      },
      {
        title: "Post-training support",
        detail:
          "Microloans, business training and continued financial literacy so graduates can start enterprises and stay independent.",
      },
    ],
    outcomes: [
      "100 vulnerable youth enrolled in and completing TVET programs",
      "Increased employability and self-reliance, especially among young mothers",
      "Reduced cultural stigma and stronger support for girls' education",
      "Greater community awareness of trafficking risks and safeguards",
      "Sustainable livelihoods for youth and their families",
    ],
    sustainability: [
      "Ongoing partnerships with TVET institutions, government and the private sector",
      "A revolving fund providing microloans to youth entrepreneurs",
      "Graduates mentoring future cohorts — a self-renewing cycle of support",
      "Long-term community work on attitudes to girls' education",
    ],
  },
  {
    slug: "climate-action",
    title: "Youth Empowerment for Climate Change & Community Development",
    subtitle: "Turning youth into champions of climate resilience",
    status: "Seeking funding",
    duration: "1 year",
    location: "Namamali Ward, Matungu Constituency, Kakamega County",
    programSlug: "community-development",
    targetGroup: "Young women and men from vulnerable backgrounds",
    stats: [
      { value: "100,000", label: "trees to be planted" },
      { value: "200", label: "youth in climate workshops" },
      { value: "100", label: "trained in climate-smart agriculture" },
      { value: "50", label: "trained in renewable energy" },
    ],
    summary:
      "A one-year program building youth capacity for climate action — climate-smart agriculture, reforestation, water conservation and renewable energy — creating green jobs while making Namamali Ward more resilient to a changing climate.",
    background: [
      "Namamali Ward depends on agriculture, which makes it acutely vulnerable to erratic weather, prolonged droughts and floods. Climate change here is not abstract: it means failed harvests, food insecurity and lost livelihoods.",
      "Young people have the most to lose and the most to give — yet they lack the education, skills and resources to lead climate adaptation. Environmental degradation is fuelling rural-urban migration, early marriages and vulnerability to exploitation.",
      "This project equips youth with practical green skills and channels them into community-driven action: tree-planting campaigns, rainwater harvesting, demonstration farms and small-scale renewable energy — blending modern techniques with traditional knowledge so solutions stick.",
    ],
    objectives: [
      "Raise youth awareness of climate change and its local impacts",
      "Train youth in climate-smart agriculture, water conservation and renewable energy",
      "Drive reforestation and environmental conservation across the ward",
      "Create sustainable green jobs through community-based enterprises",
      "Foster inclusive youth participation in climate decision-making",
      "Reduce vulnerability to exploitation by providing alternative livelihoods",
    ],
    activities: [
      {
        title: "Climate awareness workshops",
        detail:
          "Monthly capacity-building workshops for 200 youth with climate experts and environmental activists, using participatory methods.",
      },
      {
        title: "Climate-smart agriculture training",
        detail:
          "Hands-on CSA training for 100 youth with agricultural extension officers, demonstration farms, and youth-led farming cooperatives for income generation.",
      },
      {
        title: "Reforestation campaigns",
        detail:
          "Planting 100,000 indigenous and fruit trees in one year — community nurseries run by youth groups, school campaigns, and 'Adopt-a-Tree' commitments.",
      },
      {
        title: "Renewable energy training",
        detail:
          "Biogas technology and installation training for 50 youth, enabling households and farms to generate clean energy from organic waste.",
      },
      {
        title: "Leadership & mentorship",
        detail:
          "Pairing 20 emerging youth leaders with mentors in environmental science, agriculture and business.",
      },
    ],
    outcomes: [
      "A youth cohort skilled in climate-smart livelihoods",
      "100,000 trees restoring biodiversity and absorbing carbon",
      "Green enterprises: organic farming cooperatives, eco-tourism, clean energy",
      "Youth-led climate action groups that outlast the project",
    ],
    sustainability: [
      "Self-sustaining, youth-led climate action groups",
      "Partnerships with government and private sector players",
      "Continuous capacity-building beyond the project year",
    ],
  },
  {
    slug: "sports-talent-development",
    title: "Empowering Youth Through Sports & Talent Development",
    subtitle: "500 young athletes and artists, one structured pathway",
    status: "Seeking funding",
    duration: "1 year",
    location: "Namamali Ward, Matungu Constituency, Kakamega County",
    programSlug: "sports-and-talents",
    targetGroup: "Girls and boys with sporting and creative talent",
    stats: [
      { value: "500", label: "youth identified & trained" },
      { value: "3", label: "sports disciplines" },
      { value: "3", label: "creative arts tracks" },
    ],
    summary:
      "Identifying, nurturing and training 500 young people in football, volleyball and athletics, and in music, drama and art — with professional coaching, mentorship, competitions and showcases that open doors to scholarships and careers.",
    background: [
      "Namamali Ward has talent everywhere and infrastructure almost nowhere: few recreational facilities, sports fields or creative spaces, and schools that lack equipment, instruments and art supplies.",
      "Cultural norms compound the problem for girls, who are often discouraged from activities perceived as 'unfeminine' — cutting them off from the confidence, leadership skills and connections that sport and art build.",
      "This project provides the structured pathway that's missing: talent scouting, professional coaching, workshops, mentorship and public showcases that turn raw ability into marketable skill.",
    ],
    objectives: [
      "Identify and nurture sports and creative talents among 500 youth",
      "Provide training and mentorship in football, volleyball, athletics, music, drama and art",
      "Create platforms connecting youth with mentors, sponsors and professional networks",
      "Ensure equal participation of girls across every activity",
    ],
    activities: [
      {
        title: "Talent identification & registration",
        detail:
          "Outreach through schools, churches, mosques and community centres; scouting events on sports fields and performance spaces; 500 youth registered.",
      },
      {
        title: "Sports training programs",
        detail:
          "Weekly football, volleyball and athletics sessions with professional coaches, full equipment provision, and inter-ward competitions to scout exceptional talent.",
      },
      {
        title: "Creative arts development",
        detail:
          "Regular music, drama and art workshops with local artists and instructors, plus talent shows, exhibitions and community performances.",
      },
      {
        title: "Mentorship & life skills",
        detail:
          "Professionals from sports and creative industries guiding career paths — with workshops on personal branding, discipline, teamwork and financial literacy.",
      },
      {
        title: "Monitoring & evaluation",
        detail:
          "Performance assessments, feedback sessions and mid-year and end-of-year impact evaluations.",
      },
    ],
    outcomes: [
      "500 youth in structured sports and arts training",
      "Access to local, regional and national competitions and showcases",
      "Girls equally represented and supported throughout",
      "Youth equipped with life skills for leadership and careers",
    ],
    sustainability: [
      "Partnerships with schools, community leaders and county government",
      "Local business sponsorship for continued support",
      "Trained participants mentoring future cohorts",
    ],
  },
  {
    slug: "football-tournament-2024",
    title: "8-Team Community Football Tournament",
    subtitle: "Boys' and girls' teams competing as equals",
    status: "Completed",
    duration: "November 2024",
    location: "Community grounds, Namamali Ward",
    programSlug: "sports-and-talents",
    targetGroup: "Under-20 boys' and girls' football teams",
    stats: [
      { value: "8", label: "teams" },
      { value: "4", label: "girls' teams — full parity" },
      { value: "10", label: "competitive matches" },
    ],
    summary:
      "A community tournament bringing together four Under-20 boys' teams and four girls' teams in round-robin competition — promoting sportsmanship, gender equality and community unity, with kits, match balls, trophies and cash prizes for winners.",
    background: [
      "Football is a unifying sport, and this tournament was designed to unite Namamali Ward: eight teams, equal categories for boys and girls, and the whole community — parents, leaders and local stakeholders — brought together around the pitch.",
      "Beyond the matches, the tournament served as a talent-scouting platform and a public statement that girls belong in competitive sport, challenging norms that keep them out.",
    ],
    objectives: [
      "Encourage young people, boys and girls alike, into football and healthy competition",
      "Offer equal opportunities for both genders in competitive sport",
      "Provide a platform for young players to showcase their skills",
      "Involve the local community in sports-related activities to build unity",
    ],
    activities: [
      {
        title: "Round-robin competition",
        detail:
          "Each category played round-robin with the top two teams advancing to finals, across local community football grounds.",
      },
      {
        title: "Equipment & kits",
        detail:
          "Every team received a Mikasa match ball and a full uniform set.",
      },
      {
        title: "Awards ceremony",
        detail:
          "Trophies and cash prizes for winners and runners-up in both the boys' and girls' categories.",
      },
    ],
    outcomes: [
      "Enhanced visibility for local football talent",
      "Sportsmanship, gender equality and community unity promoted",
      "Increased youth participation in football",
      "A well-organised event paving the way for future tournaments",
    ],
    budgetNote:
      "Delivered on a budget of Ksh 292,000 covering match balls, uniforms for all eight teams, trophies, cash prizes, refereeing and event management.",
  },
];

export function getProject(slug: string) {
  return projects.find((p) => p.slug === slug);
}

/* ------------------------------------------------------------------ */
/* Leadership                                                          */
/* ------------------------------------------------------------------ */

export type TeamMember = {
  name: string;
  role: string;
  initials: string;
  /** Portrait in /public/team/ — falls back to initials when absent. */
  photo?: string;
  linkedin?: string;
  bio: string[];
};

export const team: TeamMember[] = [
  {
    name: "Edmond Ongoma Juma",
    role: "Founder · Chairperson & Program Director",
    initials: "EJ",
    linkedin: "https://www.linkedin.com/in/edmond-juma-3a8760229/",
    bio: [
      "Edmond is a dedicated development professional with over a decade of experience in social work and project management. He holds a Master's in Project Planning and Management and a Bachelor's in Development Studies from The Catholic University of Eastern Africa, and a Diploma in Development Studies and Social Work from Marist International University College.",
      "As Director of the James Ryken Center for Hope in Bungoma, he has worked tirelessly to support and rehabilitate street children. His earlier roles include Project Coordinator with Evolutionary Community Oriented Practitioners and Project Officer with Talitha Kum International Kenya, where he confronted human trafficking head-on.",
      "As KEYSA's Program Director, Edmond guides the organisation's efforts to empower young people across Kenya.",
    ],
  },
  {
    name: "Dr. Ngeso Aketch John Paul, Ph.D",
    role: "Founding Member · Treasurer & Resource Mobiliser",
    initials: "JP",
    linkedin:
      "https://www.linkedin.com/in/dr-ngeso-aketch-john-paul-ph-d-56371379/",
    bio: [
      "Dr. John Paul is an educator par excellence, administrator and youth advocate. He holds a PhD and a Master's in Educational Administration and Planning from The Catholic University of Eastern Africa, and a Bachelor of Education from Saint Mary's University of Minnesota (Tangaza University College).",
      "His career spans youth and community work across Kenya, South Sudan, Malawi, Zambia and the DR Congo, and roles as Admissions Coordinator and Lecturer at Tangaza University College. He currently serves as Principal Administration Officer at the Kenya National Qualifications Authority (KNQA), helping shape Kenya's education standards.",
      "At KEYSA he leads resource mobilisation, applying his fundraising and project-management expertise to youth empowerment.",
    ],
  },
  {
    name: "Peter Misiati Simboni",
    role: "Founding Member · Secretary",
    initials: "PM",
    linkedin: "https://www.linkedin.com/in/peter-simboni-97b9a1106/",
    bio: [
      "Peter serves as Secretary of the association and one of its official signatories, keeping KEYSA's governance rigorous and its records transparent.",
      "A technology professional by background, he champions KEYSA's digital skills agenda — the belief that rural youth deserve a real route into the digital economy.",
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Impact & goals shown on the home page                               */
/* ------------------------------------------------------------------ */

export const impactStats: {
  end: number;
  suffix: string;
  label: string;
  format?: boolean;
}[] = [
  { end: 5, suffix: "", label: "Thematic program areas" },
  { end: 600, suffix: "+", label: "Youth targeted across active projects" },
  { end: 100000, suffix: "", label: "Trees in our reforestation goal", format: true },
  { end: 8, suffix: "", label: "Teams in our first community tournament" },
];

/* ------------------------------------------------------------------ */
/* Donation content                                                    */
/* ------------------------------------------------------------------ */

/** Official payment channels — the only details donors should trust. */
export const donation = {
  accountName: "Youth Support Association",
  bankName: "NCBA Bank",
  accountNumber: "9672560012",
  branch: "Galleria, Karen",
  paybill: "880100",
};

export const givingExamples = [
  {
    amount: "Ksh 3,500",
    impact: "puts a quality match ball in the hands of a whole team",
  },
  {
    amount: "Ksh 8,000",
    impact: "kits out an entire youth football team with uniforms",
  },
  {
    amount: "Ksh 20,000",
    impact: "funds a month of professional coaching and talent workshops",
  },
  {
    amount: "Ksh 50,000",
    impact: "sponsors a vulnerable young person through a term of TVET training",
  },
];

export const governance = [
  {
    title: "Registered association",
    detail:
      "KEYSA is a registered non-profit association in Kenya, governed by an elected board with a chairperson, treasurer and secretary as official signatories.",
  },
  {
    title: "Accountable banking",
    detail:
      "All funds flow through the association's NCBA bank account, opened by board resolution, with the elected leadership acting as joint signatories.",
  },
  {
    title: "Board oversight",
    detail:
      "The Executive Director reports regularly to the board on the progress and impact of every project, with comprehensive reports at each board meeting.",
  },
  {
    title: "Non-profit commitment",
    detail:
      "As a community-service organisation, KEYSA directs resources to programs — and pursues KRA tax-exempt status to maximise every shilling donors give.",
  },
];

/* ------------------------------------------------------------------ */
/* News / stories                                                      */
/* ------------------------------------------------------------------ */

export type Article = {
  slug: string;
  title: string;
  /** Short label on the news card, e.g. "Essay", "Event report". */
  tag: string;
  /** Kicker above the article title, e.g. "From our founder". */
  eyebrow: string;
  author: string;
  authorRole: string;
  date: string;
  isoDate: string;
  excerpt: string;
  body: string[];
};

export const articles: Article[] = [
  {
    slug: "nairobi-youth-empowerment-forum",
    title: "Youth Empowerment Forum in Nairobi: Livelihoods That Close the Door on Traffickers",
    tag: "Event report",
    eyebrow: "News & events · Nairobi",
    author: "KEYSA Communications",
    authorRole: "News & Events",
    date: "July 2026",
    isoDate: "2026-07-30",
    excerpt:
      "KEYSA convened young people in Nairobi for a forum linking economic sustainability with anti-trafficking awareness — practical strategies for stronger livelihoods, and the knowledge to recognise and resist exploitation.",
    body: [
      "KEYSA held a youth empowerment forum in Nairobi focused on promoting economic sustainability while raising awareness about human trafficking — two struggles that are, in reality, one. Traffickers prey on economic desperation; secure livelihoods are the strongest protection a young person can have.",
      "The forum equipped participants with knowledge and practical strategies to enhance their livelihoods: understanding the push and pull factors that drive risky migration and exploitation, building income security, and making informed decisions about opportunities that sound too good to be true — because many of them are.",
      "Sessions combined presentations with open discussion, giving young people space to ask hard questions about job offers abroad, online recruitment, and the warning signs of trafficking. Participants left with concrete steps to reduce their vulnerability and with networks they can turn to when an opportunity needs verifying.",
      "This forum is part of KEYSA's growing anti-trafficking and youth-livelihoods work, which also includes our participation in the 4th International Conference on Human Trafficking at Tangaza University. We believe informed, economically empowered young people are the hardest targets traffickers will ever meet — and the strongest builders of secure, sustainable futures for their communities.",
    ],
  },
  {
    slug: "human-trafficking-conference-2026",
    title:
      "KEYSA at the 4th International Conference on Human Trafficking",
    tag: "Event report",
    eyebrow: "News & events · Tangaza University",
    author: "KEYSA Communications",
    authorRole: "News & Events",
    date: "July 2026",
    isoDate: "2026-07-29",
    excerpt:
      "KEYSA joined state actors, faith-based organisations, researchers and anti-trafficking practitioners at Tangaza University for a two-day forum on \"Human Trafficking in a Changing World\" — and came home with resolutions we intend to turn into action.",
    body: [
      "KEYSA proudly participated in the recently concluded 4th International Conference on Human Trafficking, a two-day forum held at Tangaza University under the theme \"Human Trafficking in a Changing World: Interdisciplinary Pathways for Prevention, Protection, and Human Dignity.\" The conference brought together a diverse range of stakeholders — state actors as duty bearers, faith-based organisations, the private sector, higher learning institutions, civil society organisations, researchers, development partners, and anti-human trafficking practitioners committed to strengthening the fight against human trafficking.",
      "The conference served as a strategic platform for dialogue, learning and collaboration, recognising that human trafficking has become increasingly sophisticated, technology-enabled and transnational. Participants shared experiences, research findings and innovative approaches aimed at addressing emerging trafficking trends while promoting coordinated, survivor-centred responses.",
      "Throughout the two days, deliberations focused on five key priority areas. Delegates emphasised the need to strengthen prevention through innovation, education and community action — highlighting public awareness, digital literacy, the ethical use of artificial intelligence, and early warning systems as critical tools for reducing vulnerability to trafficking. The discussions also reinforced the importance of placing survivors at the centre of all interventions, promoting trauma-informed care, legal assistance, rehabilitation, economic reintegration, and the protection of survivors' rights and dignity.",
      "Participants further underscored the value of multi-sector partnerships, acknowledging that governments, law enforcement agencies, faith-based organisations, academic institutions, development partners, survivor-led movements, the private sector and local communities must work together to deliver sustainable, measurable anti-trafficking responses. The conference also examined the increasing use of digital platforms, social media, cryptocurrency and online recruitment systems by criminal networks — calling for enhanced digital investigations, cybersecurity, data analytics and ethical technological innovation to counter these evolving threats.",
      "Another major outcome was the commitment to influence policy, research and sustainable action. Delegates recommended strengthening legislation, institutional reforms, academic research and safeguarding systems, while promoting evidence-based policymaking and international cooperation to enhance prevention, protection, prosecution and partnerships.",
      "As an organisation dedicated to protecting vulnerable children and youth from exploitation, KEYSA reaffirmed its commitment to implementing the conference resolutions through community awareness programmes, youth empowerment initiatives, strategic partnerships, advocacy and survivor-centred interventions. Combating human trafficking requires collective responsibility and continuous collaboration among all stakeholders — a responsibility we carry into every ward and village where we work.",
      "The conference concluded with a shared commitment to build stronger partnerships, deepen knowledge of emerging trafficking trends, promote innovative solutions and develop practical recommendations that contribute to safer communities — a future where every individual lives free from exploitation, violence and modern slavery. KEYSA remains committed to translating these deliberations into meaningful action that protects vulnerable populations and advances human dignity across Kenya.",
    ],
  },
  {
    slug: "crafting-a-legacy",
    title: "Crafting a Legacy Through Education and Personal Growth",
    tag: "Essay",
    eyebrow: "From our founder",
    author: "Edmond Ongoma Juma",
    authorRole: "Founder & Program Director",
    date: "2024",
    isoDate: "2024-11-01",
    excerpt:
      "Real education is about unlocking the potential that lies inside every person. The word itself comes from the Latin 'educe' — to draw out from within. Our founder reflects on legacy, learning and the generation preparing to take over.",
    body: [
      "We are on this planet for a reason, one well understood by the higher power we believe in. Our time here, though brief, is filled with purpose, and we are tasked with fulfilling our unique roles. As creators in our own right, it is crucial that we understand the urgency of the world's needs. We, in our collective being, are the agents of change. It is our responsibility to embrace this calling and shape the future. The question we must ask ourselves is: what will we leave behind for the generations that come after us?",
      "Creating prosperity isn't just about personal success but ensuring that the impact of our actions resonates with the future generation. The youth, who are already among us, are poised to take over where we leave off. The onus is on us to guide and nurture them, so they are prepared when their time comes. This guidance isn't just a matter of giving instructions; it is about laying the foundation for sustainable, self-driven growth through meaningful education.",
      "Education is often misunderstood as the mere acquisition of academic degrees, but it is much more profound. The word \"education\" stems from the Latin term \"educe\", which means to draw out from within. Real education, therefore, is about unlocking the potential that lies inside every person. This process starts with the mind, the wellspring of all aspirations. The mind is the engine of human potential, and by tapping into it, we unlock endless possibilities for development and growth.",
      "When we speak of education, we must remember that it is not limited to the classroom. Life itself is a vast source of learning. Every experience, every relationship, and every interaction with technology is part of our education. The networks we build are equally important. The saying \"show me your network, and I will know your net-worth\" is a reminder of the influence that the people around us can have on our success.",
      "The power of knowledge lies in its ability to be translated into tangible outcomes. Knowledge, when properly applied, can create wealth, opportunities, and personal fulfilment. Take the stories of Henry Ford and Thomas Edison: though they lacked formal schooling, they applied their knowledge to revolutionise industries and create lasting legacies. However, this is not to dismiss the value of education — a foundation of formal learning gives us the minimum standard needed to navigate the world and build on our self-development.",
      "Choosing the right kind of education is crucial for personal growth and future prosperity. The knowledge we acquire should align with our goals and passions. When we \"purchase\" knowledge, it is an investment in our future. Every course, every book, and every experience we engage with should bring us closer to our dreams.",
      "In choosing an educational path, personal interests and passions are essential — when we study something that excites us, we remain motivated and engaged. Focusing on skills development is critical, and the course we choose should fit the broader vision we have for our lives. Adaptability, emotional intelligence, and communication skills are vital for the challenges ahead.",
      "Networking and mentorship are also key aspects of any educational journey. The connections we make can open doors to new opportunities, and engaging with mentors allows us to tap into the wisdom of others, accelerating our personal and professional development.",
      "One point that may seem unusual is the omission of \"career opportunities\" in this context. The world is rapidly changing, and traditional job opportunities are becoming scarce. Instead of solely preparing for employment, we should focus on creating our own opportunities. Entrepreneurship and self-employment are increasingly viable paths. Knowledge must be applied toward a worthy goal, as Napoleon Hill emphasised — and that often means forging our own way in the world.",
      "In pursuing personal development and success, it is important to nurture a \"go-getter\" mentality. Life is filled with obstacles and setbacks, but these challenges are not meant to stop us. They are opportunities to refine our approach and strengthen our resolve. Defeats are temporary, and they offer valuable lessons that help us craft a workable and successful plan in the long run.",
      "The legacy we leave behind is shaped by the knowledge we acquire and the way we apply it. The future is calling us to step up, to create, and to inspire. Through education, both formal and informal, we have the power to make a lasting impact on the world, guiding the next generation toward a future filled with possibility and prosperity. Our time on this planet may be brief, but the mark we leave on it can last forever. Let us commit ourselves to this purpose, and in doing so, become the architects of a better tomorrow.",
    ],
  },
];

export function getArticle(slug: string) {
  return articles.find((a) => a.slug === slug);
}

/* ------------------------------------------------------------------ */
/* Site navigation                                                     */
/* ------------------------------------------------------------------ */

export const nav = [
  { href: "/about/", label: "About" },
  { href: "/programs/", label: "Programs" },
  { href: "/projects/", label: "Projects" },
  { href: "/get-involved/", label: "Get Involved" },
  { href: "/news/", label: "News" },
  { href: "/contact/", label: "Contact" },
];

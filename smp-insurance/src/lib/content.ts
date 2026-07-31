/**
 * Sitewide marketing content: trust signals, process steps, FAQs and
 * testimonials.
 *
 * ⚠️ Underwriter list: edit to the underwriters SMP actually holds agency
 * appointments with before launch — only list real partners.
 * ⚠️ Testimonials are SAMPLE placeholders and MUST be replaced with real,
 * permissioned client reviews before the site goes live.
 * ⚠️ Stats marked TODO must be the client's real figures.
 */

// Kenya's leading IRA-licensed underwriters. Trim/extend to actual partners.
export const underwriters = [
  "Jubilee Insurance",
  "Britam",
  "CIC Insurance Group",
  "APA Insurance",
  "Old Mutual (UAP)",
  "ICEA LION",
  "GA Insurance",
  "Madison Group",
  "AAR Insurance",
  "Heritage Insurance",
  "Sanlam Kenya",
  "First Assurance",
  "Kenindia Assurance",
  "Geminia Insurance",
];

export const stats = [
  { value: 10, suffix: "+", label: "Years serving Kenyan families & businesses" }, // TODO: real figure
  { value: 14, suffix: "+", label: "IRA-licensed underwriters we compare" },
  { value: 2500, suffix: "+", label: "Clients covered" }, // TODO: real figure
  { value: 2, suffix: "hrs", label: "Average quote turnaround (working hours)" },
];

export const howItWorks = [
  {
    title: "Tell us what you need",
    text: "Two minutes on our quote form, a WhatsApp message, or a phone call. Plain language — no jargon required.",
  },
  {
    title: "We compare the market for you",
    text: "We place your risk with Kenya's leading underwriters and bring back real quotes side by side — premiums, limits, and the fine print explained honestly.",
  },
  {
    title: "You're covered — the easy way",
    text: "Pay by M-PESA or bank (instalments available through premium financing). Motor certificates are issued digitally the same day. We diarise your renewal so cover never lapses.",
  },
  {
    title: "When you claim, we fight for you",
    text: "Claims are where an agency earns its keep. We pre-check your documents, file the claim, chase the assessors, and stay on the underwriter until you're paid.",
  },
];

export const whyUs = [
  {
    title: "Licensed & accountable",
    text: "SMP Insurance Agency is regulated by the Insurance Regulatory Authority (IRA). You can verify our licence on the IRA register — and if we ever fall short, you have a regulator to escalate to.",
  },
  {
    title: "We work for you, not one insurer",
    text: "We hold appointments with many underwriters, so our advice starts from your risk — not from one company's product list. Same premium as buying direct; far more muscle at claim time.",
  },
  {
    title: "Claims advocacy, not claims apology",
    text: "Delayed claims are the #1 insurance complaint in Kenya. Our job is to prevent yours from becoming one: complete documents the first time, relentless follow-up, and honest updates throughout.",
  },
  {
    title: "Built for how Kenya buys",
    text: "Quotes on WhatsApp. Premiums by M-PESA. Instalment plans through premium financing. Digital motor certificates verifiable at *352#. Insurance without the queue.",
  },
];

// SAMPLE placeholders — replace with real, permissioned client reviews.
export const testimonials = [
  {
    quote:
      "My car was hit at Globe roundabout on a Friday evening. SMP had the abstract checklist on my WhatsApp within minutes and the assessor came Monday. The garage released my car in under three weeks, fully settled.",
    name: "Grace W.",
    detail: "Motor comprehensive client, Nairobi",
  },
  {
    quote:
      "As a small manufacturer I had four different policies at four renewal dates. SMP consolidated everything into one business package — better cover for less than I was paying before.",
    name: "Patrick O.",
    detail: "SME package client, Industrial Area",
  },
  {
    quote:
      "When my husband was hospitalised, the pre-authorisation was sorted before we reached the ward. That is what you're really buying — someone who answers the phone when it matters.",
    name: "Amina S.",
    detail: "Family medical cover client, Mombasa",
  },
];

export const generalFaqs = [
  {
    q: "Does buying through an agency cost more than going direct?",
    a: "No. Premiums are set by the underwriter and are the same whether you buy direct or through us — agencies are remunerated by the insurer. The difference is you get independent comparison before you buy and an advocate when you claim, at no extra cost.",
  },
  {
    q: "How do I know SMP Insurance Agency is legitimate?",
    a: "We are licensed by the Insurance Regulatory Authority (IRA), which regulates all insurance intermediaries in Kenya. Our licence number is displayed in the footer of this site, and you can verify it independently on the IRA's public register at ira.go.ke.",
  },
  {
    q: "Can I pay my premium in instalments?",
    a: "Yes, through Insurance Premium Financing (IPF): a financier pays the underwriter the full annual premium so your cover starts immediately, and you repay monthly — typically over 4 to 10 months, via M-PESA. Ask for an IPF option with any quote.",
  },
  {
    q: "What happens if my insurer refuses or delays my claim?",
    a: "First, we escalate within the underwriter — a licensed agency's file carries weight. If a claim is unfairly declined or delayed, we help you escalate to the IRA's complaints process (complaints@ira.go.ke), and the Policyholders Compensation Fund protects you if an insurer ever becomes insolvent.",
  },
  {
    q: "How fast will I get my quote?",
    a: "Our promise is a quote within 2 working hours for standard covers (motor, travel, personal accident, domestic). Medical and complex business risks can take a little longer because we compare more options — we'll tell you exactly when to expect it.",
  },
  {
    q: "Is my motor insurance certificate physical or digital?",
    a: "Digital. Kenya uses Digital Motor Vehicle Insurance Certificates (DMVIC): once you pay, the certificate is emailed to you for printing and display, and anyone can verify it by dialling *352#.",
  },
  {
    q: "Which areas do you serve?",
    a: "We serve clients across Kenya. Quotes, policy documents, payments and claims can all be handled by phone, WhatsApp and email — you never have to visit our Nairobi office unless you want to.",
  },
];

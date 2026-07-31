import Link from "next/link";
import type { Metadata } from "next";
import { Container, SectionHeading, btnPrimary, Card } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ArrowRightIcon, CheckIcon, ShieldIcon } from "@/components/icons";
import { underwriters } from "@/lib/content";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "About Us — An IRA-Regulated Insurance Agency in Nairobi",
  description:
    "SMP Insurance Agency is an independent, IRA-regulated insurance agency in Nairobi, Kenya — comparing the market, explaining the fine print, and fighting for claims.",
};

const values = [
  {
    title: "Honesty before commission",
    text: "If a cheaper cover fits you better, that's the one we recommend. If an exclusion matters, you hear it before you pay — not at claim time.",
  },
  {
    title: "Speed as respect",
    text: "Quotes within 2 working hours. Claims acknowledged the same day. Renewal reminders before your cover lapses, not after.",
  },
  {
    title: "Plain language",
    text: "Insurance is full of Latin and fine print. Our job is translating it into decisions you can actually make.",
  },
  {
    title: "Long-term relationships",
    text: "We'd rather keep a client for twenty years than win one renewal. Every recommendation is made with that horizon.",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="bg-navy-950 py-14 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="About us"
            title="Independent. Regulated. On your side."
            lead={`${site.name} is an independent insurance agency serving families and businesses across Kenya. We hold agency appointments with the country's leading underwriters — which means our advice starts from your risk, not from any one company's product list.`}
            align="left"
            dark
          />
        </Container>
      </section>

      <section className="py-14 sm:py-20">
        <Container>
          <div className="grid gap-10 lg:grid-cols-2">
            <div className="space-y-5 text-base leading-relaxed text-slate-700">
              <h2 className="font-display text-2xl font-bold text-slate-900">
                Why we exist
              </h2>
              <p>
                Fewer than 3 in every 100 Kenyans have insurance — not because
                the risks aren&apos;t real, but because the industry has too
                often felt complicated, slow, and hard to trust. Policies
                written in legalese. Claims that drag for months. Covers sold
                on price that fail at the moment of truth.
              </p>
              <p>
                We started {site.name} to be the fix for our clients: one
                accountable partner who compares the market honestly, sets the
                cover up properly, and then stands next to you when it&apos;s
                time to claim. The premium costs the same as going direct —
                the difference is having a professional in your corner.
              </p>
              <p>
                Today we serve individuals, families, SMEs, schools, saccos and
                farms across Kenya — by WhatsApp, by phone, and from our
                Nairobi office.
              </p>
            </div>
            <Card className="h-fit border-navy-200 bg-navy-50">
              <h2 className="flex items-center gap-3 font-display text-xl font-bold text-navy-900">
                <ShieldIcon className="h-6 w-6 text-navy-600" />
                Licensed & verifiable
              </h2>
              <ul className="mt-5 space-y-3 text-sm leading-relaxed text-slate-700">
                <li className="flex items-start gap-3">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good-600" />
                  Regulated by the Insurance Regulatory Authority (IRA) —
                  licence No. {site.iraLicence}
                </li>
                <li className="flex items-start gap-3">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good-600" />
                  Verify our licence independently on the IRA&apos;s public
                  register at{" "}
                  <a
                    href="https://www.ira.go.ke"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-navy-600 hover:underline"
                  >
                    ira.go.ke
                  </a>
                </li>
                <li className="flex items-start gap-3">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good-600" />
                  Certificate of Proficiency (COP) qualified team, College of
                  Insurance trained
                </li>
                <li className="flex items-start gap-3">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-good-600" />
                  We place cover only with IRA-licensed underwriters — your
                  protection includes the Policyholders Compensation Fund
                </li>
              </ul>
            </Card>
          </div>
        </Container>
      </section>

      <section className="bg-paper-200 py-14 sm:py-20">
        <Container>
          <SectionHeading eyebrow="Values" title="How we work" />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((v, i) => (
              <Reveal key={v.title} delay={i * 70}>
                <Card className="h-full">
                  <h3 className="font-display text-base font-bold text-slate-900">{v.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500">{v.text}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-14 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Our partners"
            title="Underwriters we work with"
            lead="Agency appointments with Kenya's leading IRA-licensed underwriters let us compare real quotes — premiums, limits and wordings — before recommending anything."
          />
          <div className="mt-10 flex flex-wrap justify-center gap-2.5">
            {underwriters.map((u) => (
              <span key={u} className="rounded-full border border-paper-400 bg-paper-50 px-5 py-2 font-display text-sm font-bold text-navy-700">
                {u}
              </span>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-navy-900 py-14 sm:py-16">
        <Container className="text-center">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-extrabold tracking-tight text-white">
            Put us in your corner
          </h2>
          <div className="mt-7 flex justify-center">
            <Link href="/quote/" className={btnPrimary}>
              Get a free quote <ArrowRightIcon className="h-5 w-5" />
            </Link>
          </div>
        </Container>
      </section>
    </>
  );
}

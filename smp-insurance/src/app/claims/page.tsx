import Link from "next/link";
import type { Metadata } from "next";
import { Container, SectionHeading, btnWhatsApp, Card } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { ProductIcon, PhoneIcon, WhatsAppIcon, CheckIcon, ArrowRightIcon } from "@/components/icons";
import { products } from "@/lib/products";
import { site, waLink } from "@/lib/site";

export const metadata: Metadata = {
  title: "Claims Support — We Fight for Your Claim",
  description:
    "Step-by-step insurance claims guidance for motor, medical, WIBA and business covers in Kenya — with an agency that files, follows up and fights for you.",
};

const goldenRules = [
  "Report to us early — most policies require notification within 24–48 hours. A WhatsApp message is enough to start.",
  "For accidents, theft, or injury by third parties: get a police abstract. Claims without one stall.",
  "Photograph everything before anything is moved or repaired.",
  "Never admit liability at the scene — describe facts, let the process apportion blame.",
  "Keep every receipt, report and document. Complete files get paid; incomplete files get 'pended'.",
];

export default function ClaimsPage() {
  const wa = waLink("Hello SMP Insurance, I need help with a claim.");
  return (
    <>
      <section className="bg-navy-950 py-14 sm:py-20">
        <Container>
          <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <SectionHeading
                eyebrow="Claims"
                title="Bad day? This is what you hired us for."
                lead="Delayed claims are the #1 insurance complaint in Kenya. Our answer: complete documentation the first time, relentless follow-up, and honest updates until you're paid."
                align="left"
                dark
              />
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href={wa} target="_blank" rel="noopener noreferrer" className={btnWhatsApp}>
                  <WhatsAppIcon className="h-5 w-5" /> Report a claim on WhatsApp
                </a>
                <a
                  href={`tel:${site.phoneHref}`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 px-6 py-3.5 font-display text-base font-bold text-white transition hover:bg-white/10"
                >
                  <PhoneIcon className="h-5 w-5" /> {site.phone}
                </a>
              </div>
            </div>
            <Card className="border-white/10 bg-white/5">
              <h2 className="font-display text-lg font-bold text-white">
                The 5 golden rules of any claim
              </h2>
              <ul className="mt-4 space-y-3">
                {goldenRules.map((rule) => (
                  <li key={rule} className="flex items-start gap-3 text-sm leading-relaxed text-navy-200">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-cta-400" />
                    {rule}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </Container>
      </section>

      <section className="py-14 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Step by step"
            title="Claims guides by product"
            lead="Every cover claims a little differently. Open your product for the exact steps, documents and timelines."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p, i) => (
              <Reveal key={p.slug} delay={Math.min(i * 50, 250)}>
                <Link
                  href={`/products/${p.slug}/#how-claims-work`}
                  className="group flex h-full items-center gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 shadow-sm transition hover:border-navy-400 hover:shadow-md"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-600 transition group-hover:bg-navy-900 group-hover:text-cta-400">
                    <ProductIcon name={p.icon} className="h-5 w-5" />
                  </span>
                  <span className="flex-1">
                    <span className="block font-display text-base font-bold text-slate-900">
                      {p.navLabel} claims
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Steps, documents & timelines
                    </span>
                  </span>
                  <ArrowRightIcon className="h-4 w-4 text-slate-400 transition group-hover:text-navy-600" />
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-paper-200 py-14 sm:py-20">
        <Container className="max-w-3xl">
          <SectionHeading
            eyebrow="Your rights"
            title="If a claim is unfairly declined or delayed"
          />
          <div className="mt-8 space-y-4 text-sm leading-relaxed text-slate-700">
            <p>
              First, we escalate within the underwriter — a licensed agency&apos;s
              complete, well-documented file carries real weight, and most
              disputes end here.
            </p>
            <p>
              If that fails, you have a regulator. The Insurance Regulatory
              Authority (IRA) handles policyholder complaints about declined or
              delayed claims — we help you prepare and lodge the complaint at{" "}
              <a
                href="mailto:complaints@ira.go.ke"
                className="font-bold text-navy-600 hover:text-navy-500"
              >
                complaints@ira.go.ke
              </a>
              , and the IRA takes it up with the insurer directly.
            </p>
            <p>
              And if an insurer ever becomes insolvent, the Policyholders
              Compensation Fund (PCF) exists to compensate policyholders. This
              is why we only place cover with IRA-licensed underwriters.
            </p>
          </div>
        </Container>
      </section>
    </>
  );
}

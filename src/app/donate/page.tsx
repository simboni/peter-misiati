import type { Metadata } from "next";
import { givingExamples, governance, programs, site } from "@/lib/keysa";
import { PageHero } from "@/components/page-hero";
import { Button, Chip, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { Faq } from "@/components/faq";
import { CopyButton } from "@/components/copy-button";
import { ProgramIcon } from "@/components/program-icon";
import {
  ArrowRightIcon,
  CheckIcon,
  HeartIcon,
  MailIcon,
  UsersIcon,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "Donate",
  description:
    "Support KEYSA's work with vulnerable youth in Kakamega County — fund TVET scholarships, sports and talent programs, climate action and more. Bank transfer, M-Pesa and in-kind giving welcome.",
};

const faqItems = [
  {
    q: "How is my donation managed?",
    a: "All funds flow through the association's NCBA bank account, opened by formal board resolution. The elected chairperson, treasurer and secretary act as joint signatories, and the Executive Director reports on the use and impact of funds at every board meeting.",
  },
  {
    q: "Can I direct my gift to a specific program or project?",
    a: "Yes. Tell us which program (education, sports & talents, technology, financial literacy, or community development) or which specific project you want to support, and your gift will be applied there. We'll confirm in writing.",
  },
  {
    q: "Can I give equipment or services instead of money?",
    a: "Absolutely — sports kits, musical instruments, art supplies, computers, tree seedlings, professional time (coaching, counselling, tech training) and venue access are all directly useful. Write to us and we'll match your offer to a program.",
  },
  {
    q: "Is KEYSA a registered organisation?",
    a: "Yes. KEYSA is a registered non-profit association in Kenya with an elected board, formal minutes and board resolutions. Registration and governance documentation is available to donors on request, and the association is pursuing KRA tax-exempt status.",
  },
  {
    q: "How do I get updates on what my donation achieved?",
    a: "Every donor can opt in to progress updates. Project-level donors receive the quarterly stakeholder review outcomes — the same reporting our board receives.",
  },
];

export default function DonatePage() {
  const donateMailto = `mailto:${site.email}?subject=${encodeURIComponent(
    "Donation to KEYSA",
  )}&body=${encodeURIComponent(
    "Hello KEYSA team,\n\nI would like to support your work. Please send me the donation details.\n\nAmount / type of support: \nProgram or project (optional): \nName: ",
  )}`;

  return (
    <>
      <PageHero
        eyebrow="Donate"
        title="Fund the turning point in a young life"
        lede="Your gift pays school necessities, coaching sessions, tree seedlings, counselling hours and tech training — real line items in real budgets, in a community where every shilling stretches far."
      >
        <div className="mt-7 flex flex-wrap gap-3">
          <Button href={donateMailto} variant="donate">
            <HeartIcon className="h-4 w-4" />
            Start a donation
          </Button>
          <Button href="/projects/" variant="ghost">
            See what needs funding
            <ArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </PageHero>

      {/* What your money does */}
      <section className="py-16 sm:py-20">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              eyebrow="Impact of a gift"
              title="What your support buys on the ground"
              lede="Figures drawn from our actual project budgets in Namamali Ward."
            />
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {givingExamples.map((example, i) => (
              <Reveal key={example.amount} delay={i * 70}>
                <div className="h-full rounded-2xl border border-ink-600 bg-ink-800 p-6">
                  <p className="font-display text-2xl font-bold text-accent-400">
                    {example.amount}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-mist-400">
                    {example.impact}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Ways to give */}
      <section className="border-y border-ink-600 bg-ink-850 py-16 sm:py-20">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              eyebrow="Ways to give"
              title="Choose the channel that suits you"
            />
          </Reveal>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <Reveal delay={0}>
              <div className="win flex h-full flex-col p-7">
                <Chip tone="green">Bank transfer</Chip>
                <h3 className="mt-4 font-display text-lg font-bold text-mist-100">
                  Direct to our NCBA account
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-mist-400">
                  The association banks with NCBA Bank under the account name{" "}
                  <span className="font-semibold text-mist-200">
                    Youth Support Association
                  </span>
                  . Email us and we’ll send the account number and branch details,
                  plus a written acknowledgement of your gift.
                </p>
                <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-ink-600 bg-ink-900 px-4 py-3">
                  <span className="truncate text-sm font-medium text-mist-200">
                    {site.email}
                  </span>
                  <CopyButton value={site.email} label="email address" />
                </div>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="win flex h-full flex-col p-7">
                <Chip tone="green">Mobile money</Chip>
                <h3 className="mt-4 font-display text-lg font-bold text-mist-100">
                  M-Pesa
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-mist-400">
                  For donors in Kenya, M-Pesa is the fastest way to give. Contact us
                  for the current till/paybill details — we confirm every mobile
                  contribution with a receipt referencing your transaction code.
                </p>
                <div className="mt-5">
                  <Button href={donateMailto} variant="primary" className="w-full">
                    <MailIcon className="h-4 w-4" />
                    Request M-Pesa details
                  </Button>
                </div>
              </div>
            </Reveal>
            <Reveal delay={160}>
              <div className="win flex h-full flex-col p-7">
                <Chip tone="green">In-kind & major gifts</Chip>
                <h3 className="mt-4 font-display text-lg font-bold text-mist-100">
                  Equipment, skills & sponsorship
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-mist-400">
                  Sponsor a tournament, donate sports kits or computers, offer
                  professional time, or fund an entire project as a named partner.
                  We’ll build a package around your goals — with reporting to match.
                </p>
                <div className="mt-5">
                  <Button href="/contact/" variant="ghost" className="w-full">
                    Talk to our team
                  </Button>
                </div>
              </div>
            </Reveal>
          </div>
          <Reveal delay={220}>
            <p className="mt-8 text-center text-xs leading-relaxed text-mist-500">
              We publish payment details only through direct correspondence to protect
              donors from impersonation scams. Always verify channel details with{" "}
              {site.email} before sending funds.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Where it goes */}
      <section className="py-16 sm:py-20">
        <div className="container-page grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <div>
              <SectionHeading
                eyebrow="Where it goes"
                title="Five programs, one pipeline of opportunity"
              />
              <p className="mt-5 text-sm leading-relaxed text-mist-400">
                Undesignated gifts are allocated by the board to the area of
                greatest need across our five thematic programs. Designated gifts
                go exactly where you point them.
              </p>
              <ul className="mt-6 space-y-3">
                {governance.slice(0, 3).map((g) => (
                  <li
                    key={g.title}
                    className="flex items-start gap-2.5 text-sm leading-relaxed text-mist-400"
                  >
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                    <span>
                      <span className="font-semibold text-mist-200">{g.title}.</span>{" "}
                      {g.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <div className="grid gap-3 sm:grid-cols-2">
            {programs.map((program, i) => (
              <Reveal key={program.slug} delay={i * 60}>
                <div className="flex h-full items-start gap-4 rounded-2xl border border-ink-600 bg-ink-800 p-5">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-400/10 text-green-400">
                    <ProgramIcon name={program.icon} className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-sm font-bold text-mist-100">
                      {program.name}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-mist-500">
                      {program.tagline}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
            <Reveal delay={programs.length * 60}>
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-accent-400/40 bg-accent-400/5 p-5 text-center">
                <div>
                  <UsersIcon className="mx-auto h-6 w-6 text-accent-400" />
                  <p className="mt-2 text-xs font-semibold text-mist-200">
                    Greatest need — let the board allocate
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-ink-600 bg-ink-850 py-16 sm:py-20">
        <div className="container-page grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <Reveal>
            <div>
              <SectionHeading eyebrow="Donor FAQ" title="Answers before you give" />
              <p className="mt-5 text-sm leading-relaxed text-mist-400">
                Anything else on your mind? Write to{" "}
                <a
                  href={`mailto:${site.email}`}
                  className="font-medium text-green-400 hover:underline"
                >
                  {site.email}
                </a>{" "}
                — a board member will reply personally.
              </p>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <Faq items={faqItems} />
          </Reveal>
        </div>
      </section>
    </>
  );
}

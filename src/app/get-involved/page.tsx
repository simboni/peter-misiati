import type { Metadata } from "next";
import { site } from "@/lib/keysa";
import { PageHero } from "@/components/page-hero";
import { Button, Chip, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import {
  ArrowRightIcon,
  CheckIcon,
  CompassIcon,
  HandshakeIcon,
  HeartIcon,
  LeafIcon,
  TrophyIcon,
  UsersIcon,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "Get Involved",
  description:
    "Volunteer, mentor, coach, partner or sponsor with KEYSA — there are many ways beyond donating to help empower young people in Kakamega County.",
};

const roles = [
  {
    icon: CompassIcon,
    title: "Become a mentor",
    text: "Guide a young person through education, enterprise or early career. Our mentorship programs pair professionals with youth in TVET, agriculture, business, sports and the arts — a few hours a month changes trajectories.",
    tags: ["Remote-friendly", "2–4 hrs/month"],
  },
  {
    icon: TrophyIcon,
    title: "Coach or teach a skill",
    text: "Football, volleyball, athletics, music, drama, art, tech, financial literacy — if you can teach it, our youth want to learn it. Join a training weekend or run a recurring workshop.",
    tags: ["On the ground", "Skills-based"],
  },
  {
    icon: LeafIcon,
    title: "Join climate action days",
    text: "Tree-planting drives, community nurseries, climate-smart farm demonstrations and clean-energy builds. Perfect for groups, schools and corporate volunteering days.",
    tags: ["Groups welcome", "Hands-on"],
  },
  {
    icon: HandshakeIcon,
    title: "Partner as an organisation",
    text: "TVET institutions, businesses, foundations, county government, faith communities — we co-design programs with partners and report like we mean it. Sponsorship packages available for tournaments and showcases.",
    tags: ["Institutional", "Co-designed"],
  },
  {
    icon: UsersIcon,
    title: "Spread the word",
    text: "Follow and share our work. Introduce us to one person who should know about KEYSA — a donor, an employer who hires our graduates, a journalist. Word of mouth is our oldest program.",
    tags: ["5 minutes", "Anywhere"],
  },
  {
    icon: HeartIcon,
    title: "Give — once or monthly",
    text: "The fastest way to help. Fund a scholarship, kit a team, or make a monthly pledge that lets us plan ahead with confidence.",
    tags: ["From Ksh 500", "Any currency"],
  },
] as const;

export default function GetInvolvedPage() {
  const volunteerMailto = `mailto:${site.email}?subject=${encodeURIComponent(
    "I want to get involved with KEYSA",
  )}&body=${encodeURIComponent(
    "Hello KEYSA team,\n\nI'd like to get involved.\n\nHow I can help (mentoring / coaching / climate days / partnership / other): \nWhere I'm based: \nName: ",
  )}`;

  return (
    <>
      <PageHero
        eyebrow="Get involved"
        title="Money matters — but so do hands, skills and time"
        lede="KEYSA was built by volunteers who refused to wait for permission to help their community. Whatever you have to give, there's a place for it here."
      >
        <div className="mt-7 flex flex-wrap gap-3">
          <Button href={volunteerMailto}>
            Offer your help
            <ArrowRightIcon className="h-4 w-4" />
          </Button>
          <Button href="/donate/" variant="donate">
            <HeartIcon className="h-4 w-4" />
            Donate instead
          </Button>
        </div>
      </PageHero>

      <section className="py-16 sm:py-20">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              eyebrow="Six ways in"
              title="Choose your way to show up"
            />
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((role, i) => (
              <Reveal key={role.title} delay={i * 70}>
                <div className="flex h-full flex-col rounded-2xl border border-ink-600 bg-ink-800 p-7">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-green-400/10 text-green-400">
                    <role.icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-bold text-mist-100">
                    {role.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-mist-400">
                    {role.text}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {role.tags.map((tag) => (
                      <Chip key={tag}>{tag}</Chip>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Why volunteer with KEYSA */}
      <section className="border-t border-ink-600 bg-ink-850 py-16 sm:py-20">
        <div className="container-page grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <div>
              <SectionHeading
                eyebrow="What you can expect"
                title="We take volunteers as seriously as donors"
              />
              <ul className="mt-6 space-y-3">
                {[
                  "A named board contact and a clear role description before you start",
                  "Safeguarding-first culture — we work with vulnerable young people and act like it",
                  "Real responsibility: our programs are volunteer-powered, not volunteer-decorated",
                  "Recognition and references for sustained contribution",
                ].map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-2.5 text-sm leading-relaxed text-mist-400"
                  >
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="win p-8 text-center">
              <p className="font-display text-xl font-bold text-mist-100">
                Ready when you are
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-mist-400">
                One email starts the conversation. Tell us what you’re good at and
                how much time you have — we’ll suggest the best fit.
              </p>
              <div className="mt-6">
                <Button href={volunteerMailto} className="w-full sm:w-auto">
                  Email {site.email}
                </Button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}

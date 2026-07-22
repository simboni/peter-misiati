import {
  profile,
  about,
  skills,
  experience,
  testimonials,
} from "@/lib/portfolio";
import { Button, Section, SectionHeading, Eyebrow } from "@/components/ui";
import { Reveal } from "@/components/reveal";
import { CountUp } from "@/components/count-up";
import { Chip } from "@/components/project-card";
import { WorkIndex } from "@/components/work-index";
import { ReviewCard } from "@/components/review-card";
import { ClientLogos } from "@/components/client-logos";
import { StackupSpotlight } from "@/components/stackup-spotlight";
import {
  ServiceIcon,
  GitHubIcon,
  LinkedInIcon,
  MailIcon,
  DownloadIcon,
  CheckIcon,
} from "@/components/icons";

export default function HomePage() {
  return (
    <>
      {/* ============================= HERO ============================= */}
      <section className="relative overflow-hidden border-b border-ink-700 glow-bg">
        <div className="container-page relative py-14 sm:py-24 lg:py-32">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 text-sm text-mist-400">
              <span className="inline-flex h-2 w-2 rounded-full bg-green-400" />
              {profile.availability}
            </span>

            <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight text-mist-100 text-balance sm:text-6xl">
              I build the software your organisation runs on.
            </h1>

            <p className="mt-6 text-lg text-mist-300">
              {profile.name} — {profile.role}
            </p>

            <p className="mt-4 max-w-xl leading-relaxed text-mist-400">
              {profile.valueProp}
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <Button href="/work" variant="gold" size="lg" withArrow>
                View my work
              </Button>
              <Button href="/contact" variant="outline" size="lg">
                Get in touch
              </Button>
            </div>

            <div className="mt-10 flex items-center gap-2.5">
              {profile.socials.github && (
                <HeroSocial href={profile.socials.github} label="GitHub">
                  <GitHubIcon className="h-5 w-5" />
                </HeroSocial>
              )}
              {profile.socials.linkedin && (
                <HeroSocial href={profile.socials.linkedin} label="LinkedIn">
                  <LinkedInIcon className="h-5 w-5" />
                </HeroSocial>
              )}
              <HeroSocial href={`mailto:${profile.email}`} label="Email">
                <MailIcon className="h-5 w-5" />
              </HeroSocial>
              {profile.resumeUrl && (
                <a
                  href={profile.resumeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-ink-600 px-4 py-2 text-sm text-mist-300 transition-colors hover:border-green-400/60 hover:text-green-300"
                >
                  <DownloadIcon className="h-4 w-4" /> Résumé
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Stat strip */}
        <div className="border-t border-ink-700 bg-ink-950/40">
          <div className="container-page grid grid-cols-2 gap-6 py-8 sm:grid-cols-4">
            {profile.stats.map((s) => (
              <div key={s.label}>
                <div className="font-display text-3xl font-bold text-mist-100 sm:text-4xl">
                  <CountUp end={s.value} suffix={s.suffix} />
                </div>
                <div className="mt-1 text-sm text-mist-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== FLAGSHIP PRODUCT ======================== */}
      <StackupSpotlight />

      {/* ===================== WORKED-WITH LOGO WALL ==================== */}
      <ClientLogos />

      {/* ========================= WORK INDEX ========================== */}
      <Section id="work">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            eyebrow="selected work"
            title="Things I've designed & shipped"
            intro="Tap a project to preview it — every one links to a full case study."
          />
          <Button href="/work" variant="outline" withArrow className="shrink-0">
            all projects
          </Button>
        </div>
        <WorkIndex />
      </Section>

      {/* ============================ SKILLS =========================== */}
      <Section id="skills" className="border-y border-ink-700 bg-ink-850">
        <SectionHeading
          eyebrow="stack"
          title="What I build with"
          intro="A modern, TypeScript-first toolkit — plus the WordPress, mobile and fintech range to back it up."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((group, i) => (
            <Reveal key={group.title} delay={i * 50}>
              <div className="h-full rounded-xl border border-ink-600 bg-ink-800 p-5 transition-colors hover:border-green-400/40">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-green-400/10 text-green-400">
                    <ServiceIcon name={group.icon} className="h-5 w-5" />
                  </span>
                  <h3 className="font-display font-semibold text-mist-100">{group.title}</h3>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {group.items.map((item) => (
                    <Chip key={item}>{item}</Chip>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ========================== EXPERIENCE ========================= */}
      <Section>
        <SectionHeading eyebrow="experience" title="Where I've been building" />
        <div className="mt-12 space-y-4">
          {experience.map((job, i) => (
            <Reveal key={`${job.company}-${i}`} delay={i * 60}>
              <div className="grid gap-4 rounded-xl border border-ink-600 bg-ink-800 p-6 sm:grid-cols-12 sm:p-7">
                <div className="sm:col-span-4">
                  <div className="font-mono text-xs text-green-400">{job.period}</div>
                  <h3 className="mt-1 font-display text-lg font-semibold text-mist-100">
                    {job.role}
                  </h3>
                  <div className="text-sm text-mist-400">{job.company}</div>
                  {job.location && (
                    <div className="mt-1 font-mono text-xs text-mist-600">{job.location}</div>
                  )}
                </div>
                <div className="sm:col-span-8">
                  <p className="text-sm leading-relaxed text-mist-400">{job.summary}</p>
                  <ul className="mt-3 space-y-2">
                    {job.highlights.map((h) => (
                      <li key={h} className="flex gap-2.5 text-sm text-mist-300">
                        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* =========================== ABOUT ============================= */}
      <Section className="border-y border-ink-700 bg-ink-850">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Eyebrow>about</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-mist-100 text-balance sm:text-4xl">
              Engineer, builder, and relentless finisher.
            </h2>
            <p className="mt-5 leading-relaxed text-mist-400">{about.paragraphs[0]}</p>
            <Button href="/about" variant="outline" withArrow className="mt-7">
              more about me
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
            {about.principles.map((p, i) => (
              <Reveal key={p.title} delay={i * 50}>
                <div className="h-full rounded-xl border border-ink-600 bg-ink-800 p-5">
                  <h3 className="font-display font-semibold text-green-300">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-mist-400">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* ========================= TESTIMONIALS ======================== */}
      {testimonials.length > 0 && (
        <Section>
          <SectionHeading
            eyebrow="reviews"
            title="What clients say"
            align="center"
            className="mx-auto"
          />
          <div
            className={`mx-auto mt-12 grid gap-6 ${
              testimonials.length === 1
                ? "max-w-2xl"
                : "sm:grid-cols-2 lg:grid-cols-3"
            }`}
          >
            {testimonials.map((review, i) => (
              <Reveal key={review.author + i} delay={i * 80} className="h-full min-w-0">
                <ReviewCard review={review} />
              </Reveal>
            ))}
          </div>
        </Section>
      )}

      {/* ============================= CTA ============================= */}
      <section className="relative overflow-hidden border-t border-ink-700 glow-bg">
        <div className="container-page py-24 text-center">
          <Eyebrow>Let&rsquo;s build</Eyebrow>
          <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-bold leading-tight tracking-tight text-mist-100 text-balance sm:text-4xl">
            Have a project in mind? Let&rsquo;s ship it.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-mist-400">
            A new product, a rescue mission, or a role on your team — I&rsquo;d love to hear about it.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button href="/contact" variant="gold" size="lg" withArrow>
              start a conversation
            </Button>
            <Button href={`mailto:${profile.email}`} variant="outline" size="lg">
              <MailIcon className="h-5 w-5" /> {profile.email}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

function HeroSocial({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      aria-label={label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-ink-600 bg-ink-800 text-mist-300 transition-colors hover:border-green-400/50 hover:text-green-400"
    >
      {children}
    </a>
  );
}

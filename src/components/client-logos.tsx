import Link from "next/link";
import { projects, type Project } from "@/lib/portfolio";
import { Eyebrow } from "@/components/ui";
import { ArrowRightIcon } from "@/components/icons";

/**
 * "Worked with" marquee — a single row of the works on this portfolio, sliding
 * slowly to the right and looping seamlessly. Each logo sits on the background
 * its brand was designed for, and links to the project's live site. Constrained
 * to the site content width; a "show all partners" button opens the full,
 * categorised partners page.
 */

// Only the works that appear on the portfolio; the site itself isn't a client.
export const partnerWorks = projects.filter((p) => p.slug !== "smp-portfolio");

export function ClientLogos() {
  if (partnerWorks.length === 0) return null;

  // Two identical copies make the loop seamless (track animates by -50%).
  const loop = [...partnerWorks, ...partnerWorks];

  return (
    <section className="border-y border-ink-700 bg-ink-950/40">
      <div className="container-page py-14 sm:py-16">
        <div className="flex flex-col items-center text-center">
          <Eyebrow>worked with</Eyebrow>
          <p className="mt-3 text-sm text-mist-500">
            Brands and organisations behind the work
          </p>
        </div>

        {/* Marquee: constrained to content width, edges fade, pauses on hover */}
        <div
          className="marquee group relative mt-10 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]"
          aria-label="Project brands"
        >
          <ul className="marquee-track">
            {loop.map((p, i) => (
              <LogoItem key={`${p.slug}-${i}`} project={p} duplicate={i >= partnerWorks.length} />
            ))}
          </ul>
        </div>

        <div className="mt-10 flex justify-center">
          <Link
            href="/partners"
            className="group/btn inline-flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-5 py-2.5 text-sm font-medium text-mist-200 transition-all duration-200 hover:border-green-400 hover:text-green-300 hover:bg-green-400/5"
          >
            Show all partners
            <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/** A single brand chip on the marquee. */
export function LogoItem({ project, duplicate }: { project: Project; duplicate: boolean }) {
  const href = project.links.live ?? `/work/${project.slug}`;
  return (
    <li className="mr-5 shrink-0" aria-hidden={duplicate || undefined}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${project.title} — visit`}
        tabIndex={duplicate ? -1 : undefined}
        style={project.logoBg ? { background: project.logoBg } : undefined}
        className="flex h-20 w-56 items-center justify-center rounded-xl border border-ink-600 px-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-green-400/60 hover:shadow-[0_16px_40px_-28px_rgba(0,0,0,0.75)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 sm:h-24 sm:w-64"
      >
        <BrandLogo project={project} hideAlt={duplicate} />
      </a>
    </li>
  );
}

/** Logo image with a wordmark fallback until a brand logo is supplied. */
export function BrandLogo({ project, hideAlt }: { project: Project; hideAlt?: boolean }) {
  if (!project.logo) {
    return (
      // logoBg is a fixed brand colour (inline style), so the fallback
      // wordmark must be a fixed dark too — not a theme token.
      <span className="font-display text-xl font-bold tracking-tight text-[#14181a] sm:text-2xl">
        {project.title}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={project.logo}
      alt={hideAlt ? "" : project.title}
      className="max-h-11 max-w-full object-contain sm:max-h-12"
      loading="lazy"
    />
  );
}

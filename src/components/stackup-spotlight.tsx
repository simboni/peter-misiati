import Link from "next/link";
import { getProject } from "@/lib/portfolio";
import { Button } from "@/components/ui";
import { ExternalLinkIcon, GitHubIcon, ArrowRightIcon } from "@/components/icons";

/**
 * Flagship-product band for the home page. StackUp is SMP's own venture — not
 * a client build — so it gets a distinct spotlight with the product's own
 * (purple) accent, set apart from the client work below.
 */

const PURPLE = "#7B68EE";

export function StackupSpotlight() {
  const p = getProject("stackup");
  if (!p) return null;

  return (
    <section className="border-b border-ink-700 bg-ink-850">
      <div className="container-page py-16 sm:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          {/* Copy */}
          <div className="order-2 lg:order-1">
            <span
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]"
              style={{ color: PURPLE, borderColor: `${PURPLE}66`, background: `${PURPLE}14` }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: PURPLE }} />
              Flagship product · building in the open
            </span>

            <h2 className="mt-5 font-display text-3xl font-bold leading-tight tracking-tight text-mist-100 text-balance sm:text-4xl">
              StackUp — the product I&rsquo;m building, not just shipping for clients.
            </h2>
            <p className="mt-4 max-w-xl leading-relaxed text-mist-400">{p.summary}</p>

            <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {[
                "Database-enforced multi-tenancy (fail-closed RLS)",
                "One codebase → API, web & mobile",
                "Open & self-hostable",
                "CI-gated tenant isolation on every push",
              ].map((point) => (
                <li key={point} className="flex gap-2.5 text-sm text-mist-300">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: PURPLE }}
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button href={`/work/${p.slug}`} variant="outline" withArrow>
                Read the case study
              </Button>
              {p.links.live && (
                <a
                  href={p.links.live}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-mist-200 transition-colors hover:text-green-300"
                >
                  <ExternalLinkIcon className="h-4 w-4" /> Live site
                </a>
              )}
              {p.links.code && (
                <a
                  href={p.links.code}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-mist-200 transition-colors hover:text-green-300"
                >
                  <GitHubIcon className="h-4 w-4" /> Code
                </a>
              )}
            </div>
          </div>

          {/* Preview — dashboard up front, sign-in peeking behind */}
          <div className="order-1 lg:order-2">
            <Link
              href={`/work/${p.slug}`}
              aria-label="StackUp — case study"
              className="group relative block"
            >
              {p.media[1] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.media[1].src}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className="absolute -right-3 -top-6 hidden w-1/2 rotate-[3deg] rounded-xl border border-ink-600 opacity-90 shadow-[0_24px_50px_-30px_rgba(0,0,0,0.7)] transition-transform duration-500 group-hover:-translate-y-1 sm:block"
                />
              )}
              {p.media[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.media[0].src}
                  alt={p.media[0].alt}
                  loading="lazy"
                  className="relative w-full overflow-hidden rounded-2xl border border-ink-600 shadow-[0_30px_70px_-40px_rgba(123,104,238,0.65)] transition-transform duration-500 group-hover:scale-[1.02]"
                />
              )}
            </Link>
            <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-mist-500">
              <span>Dashboard &amp; sign-in — full case study</span>
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { showcase, showcaseSlugs, type Showcase } from "@/lib/showcase";
import { projects } from "@/lib/portfolio";
import { Screen } from "@/components/screen-frame";
import { ArrowUpRightIcon, ExternalLinkIcon } from "@/components/icons";

/* ---------------------------------------------------------------------------
   The wall.

   One slab per project that has real captured screens: a big hero shot, the
   client's name, ONE sentence about what it does for them, a live link, and
   then the unglamorous screens underneath. The sentence is the whole text
   budget — anyone who wants the architecture clicks through to the case study,
   which is unchanged.

   Slabs alternate which side the words sit on, so a long page of screenshots
   has a rhythm instead of becoming a catalogue.

   Below the wall, every other project appears as an image in a mosaic. Those
   have mockups rather than captured screens, and padding the wall with them
   would dilute exactly what makes it convincing.
--------------------------------------------------------------------------- */

function Slab({ item, index }: { item: Showcase; index: number }) {
  const wordsRight = index % 2 === 1;
  const caseStudy = `/work/${item.slug}`;

  return (
    <article className="border-t border-ink-700 py-14 first:border-t-0 sm:py-20">
      <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
        {/* Words */}
        <div className={`lg:col-span-4 ${wordsRight ? "lg:order-2" : ""}`}>
          <h3 className="font-display text-3xl font-bold leading-tight tracking-tight text-mist-100 sm:text-4xl">
            {item.client}
          </h3>
          <p className="mt-4 text-lg leading-relaxed text-mist-400 text-pretty">
            {item.outcome}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a
              href={item.live}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-green-400 underline-offset-4 hover:underline"
            >
              {item.liveLabel}
              <ExternalLinkIcon className="h-3.5 w-3.5" />
            </a>
            <Link
              href={caseStudy}
              prefetch={false}
              className="inline-flex items-center gap-1 text-sm font-semibold text-mist-500 underline-offset-4 hover:text-mist-200 hover:underline"
            >
              How it was built
              <ArrowUpRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* The hero screen */}
        <div className={`lg:col-span-8 ${wordsRight ? "lg:order-1" : ""}`}>
          <Screen shot={item.hero} url={item.liveLabel} priority={index === 0} />
        </div>
      </div>

      {/* The screens nobody else shows */}
      {item.proof.length > 0 && (
        <div
          // Two across at most. Three made the admin screens — which are
          // forms, and dense by nature — read as grey rectangles, and a shot
          // nobody can read is decoration rather than evidence.
          className={`mt-8 grid items-start gap-6 ${
            item.proof.length === 1 ? "sm:grid-cols-1" : "sm:grid-cols-2"
          }`}
        >
          {item.proof.map((shot) => (
            <Screen
              key={shot.src}
              shot={shot}
              compact
              className={item.proof.length === 1 ? "sm:items-start" : ""}
            />
          ))}
        </div>
      )}
    </article>
  );
}

/** The mosaic shows these around 420px wide; the originals are up to 2160px.
    Serving those would be five times the pixels anyone sees, on a page whose
    whole argument is that it is fast. `public/mockups/thumbs` is generated at
    800px — enough for retina at this size and nothing more. */
function thumb(src: string) {
  return src
    .replace("/mockups/", "/mockups/thumbs/")
    .replace(/\.(jpg|jpeg|png)$/i, ".webp");
}

/** Everything else: one image each, name on top, straight through to the case study. */
function Mosaic() {
  const rest = projects.filter((p) => !showcaseSlugs.has(p.slug) && p.media[0]);
  if (rest.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rest.map((p) => (
        <Link
          key={p.slug}
          href={`/work/${p.slug}`}
          // Twelve links in the viewport means Next prefetches twelve case
          // studies, and in a static export a prefetch pulls the whole HTML
          // document — images included. That was 1.8MB of pictures for pages
          // nobody had opened, on the page whose argument is that it is fast.
          // The case study is one tap away; it can load when it is wanted.
          prefetch={false}
          className="group relative block overflow-hidden rounded-xl border border-ink-600 bg-ink-800 transition-all duration-300 hover:-translate-y-1 hover:border-green-400/50"
        >
          <div className="relative aspect-[16/10] overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb(p.media[0].src)}
              alt={p.media[0].alt}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
            />
            {/* Fixed black scrim — it sits on an image, so it must not follow the theme. */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-4">
              <p className="font-display text-lg font-semibold leading-tight text-white">{p.title}</p>
              <p className="mt-0.5 line-clamp-1 text-sm text-white/70">{p.tags.join(" · ")}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function VisualWall() {
  return (
    <>
      {showcase.map((item, i) => (
        <Slab key={item.slug} item={item} index={i} />
      ))}
      <div className="border-t border-ink-700 pt-14 sm:pt-20">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-green-400">
          and the rest
        </p>
        <h3 className="mt-3 font-display text-2xl font-bold tracking-tight text-mist-100 sm:text-3xl">
          {projects.filter((p) => !showcaseSlugs.has(p.slug)).length} more, all live
        </h3>
        <div className="mt-8">
          <Mosaic />
        </div>
      </div>
    </>
  );
}

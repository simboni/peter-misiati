import Link from "next/link";
import { showcase, showcaseSlugs } from "@/lib/showcase";
import { projects } from "@/lib/portfolio";
import { ProjectGallery } from "@/components/project-gallery";

/* ---------------------------------------------------------------------------
   The wall.

   One GALLERY per project that has real captured screens: the client's name,
   one sentence about what the system does for them, a live link, and beside it
   a single frame holding every screen of that project, picked from a strip of
   thumbnails. The sentence is the whole text budget — anyone who wants the
   architecture clicks through to the case study, which is unchanged.

   It used to be a pile instead of a frame: a big hero shot, then a grid of two
   or three more underneath, each in its own box at its own size. Four projects
   of that is sixteen separate frames of four different shapes running down the
   home page, and the reader has to work out which pictures belong to which
   client. One frame per project says it instead of asking.

   Galleries alternate which side the words sit on, so a long page of
   screenshots has a rhythm instead of becoming a catalogue.

   Below the wall, every other project appears as an image in a mosaic. Those
   have mockups rather than captured screens, and padding the wall with them
   would dilute exactly what makes it convincing.
--------------------------------------------------------------------------- */

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
  /*
   * EVERY project that is not in the showcase, screenshot or not.
   *
   * This used to require `p.media[0]`, so a project with no screenshots was
   * silently dropped from the grid — shipped, written up, linked, and then
   * invisible on the homepage with nothing anywhere to say so. Riziki
   * Chemicals, a full POS, sat unlisted that way: the only project in the
   * catalogue without images, and therefore the only one missing.
   *
   * A missing picture is a reason to draw the cover instead, which is exactly
   * what the work page and the project card already do. It is not a reason to
   * hide the work.
   */
  const rest = projects.filter((p) => !showcaseSlugs.has(p.slug));
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
          <div className={`relative aspect-[16/10] overflow-hidden ${p.media[0] ? "" : `bg-gradient-to-br ${p.cover.from} ${p.cover.to}`}`}>
            {p.media[0] ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumb(p.media[0].src)}
                  alt={p.media[0].alt}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                />
              </>
            ) : (
              // No screenshot yet: the branded cover, same as the work page and
              // the project card draw. The tile still reads as a real project.
              <>
                <div className="absolute inset-0 bg-grid opacity-40" />
                <span className="absolute inset-0 grid place-items-center font-mono text-4xl font-bold tracking-tight text-white/90">
                  {p.cover.initials}
                </span>
              </>
            )}
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
        <ProjectGallery key={item.slug} item={item} index={i} />
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

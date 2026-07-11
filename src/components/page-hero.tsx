import { Eyebrow } from "@/components/ui";

/**
 * Inner-page hero band — a compact green header with an optional field
 * photograph washed behind the title.
 */
export function PageHero({
  eyebrow,
  title,
  intro,
  image,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  image?: string;
}) {
  return (
    <section className="relative isolate overflow-hidden bg-forest-900">
      {image && (
        <div className="absolute inset-0 -z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-forest-950/92 via-forest-950/80 to-forest-900/55" />
        </div>
      )}
      {!image && <div className="absolute inset-0 -z-10 wash-green opacity-60" />}

      <div className="container-page py-20 sm:py-24 lg:py-28">
        <div className="max-w-3xl">
          {eyebrow && (
            <Eyebrow className="!text-leaf-400">{eyebrow}</Eyebrow>
          )}
          <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-white text-balance sm:text-5xl">
            {title}
          </h1>
          {intro && (
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-forest-100/85 text-pretty">
              {intro}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

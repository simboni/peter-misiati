import { Eyebrow } from "@/components/ui";

/** Shared interior-page hero band with the quiet grid + glow treatment. */
export function PageHero({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-ink-600 bg-ink-850">
      <div className="absolute inset-0 bg-grid" aria-hidden />
      <div className="absolute inset-0 glow-bg" aria-hidden />
      <div className="container-page relative py-16 sm:py-20">
        <div className="hero-stagger max-w-3xl">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="font-display text-4xl font-bold tracking-tight text-mist-100 sm:text-5xl text-balance">
            {title}
          </h1>
          {lede ? (
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-mist-400">{lede}</p>
          ) : null}
          {children}
        </div>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useRef, useState } from "react";

/**
 * Swipeable money-card carousel for the dashboard hero (Owed / Received / Net),
 * like a mobile-banking home. Driven by plain data props (no server elements or
 * React.Children juggling) so it renders reliably everywhere, including the
 * Cloudflare Workers runtime.
 */
export type HeroChip = { text: string; amber?: boolean };
export type HeroCard = {
  label: string;
  amount: string;
  cur: string;
  chips?: HeroChip[];
  link?: { href: string; label: string };
};

export function HeroCarousel({ cards }: { cards: HeroCard[] }) {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setActive((a) => (a === i ? a : Math.max(0, Math.min(cards.length - 1, i))));
  };

  const goTo = (i: number) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-x-visible lg:px-0 lg:pb-0"
      >
        {cards.map((c, i) => (
          <div key={i} className="w-full flex-none snap-center lg:w-auto">
            <section
              className="relative h-full overflow-hidden rounded-3xl p-6 text-white shadow-[0_18px_40px_-20px_rgba(4,120,87,0.7)]"
              style={{ background: "linear-gradient(140deg, #059669 0%, #047857 52%, #065f46 100%)" }}
            >
              <div className="pointer-events-none absolute -right-12 -top-16 h-52 w-52 rounded-full bg-white/10" />
              <div className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-black/10" />
              <div className="relative flex h-full flex-col">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white/80">{c.label}</p>
                  <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold tracking-wide">{c.cur}</span>
                </div>
                <p className="mt-2 text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl lg:text-4xl xl:text-5xl">{c.amount}</p>
                {(c.chips?.length || c.link) && (
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-4 text-xs">
                    {c.chips?.map((ch, j) => (
                      <span
                        key={j}
                        className={
                          ch.amber
                            ? "rounded-full bg-amber-300 px-3 py-1 font-bold text-amber-950"
                            : "rounded-full bg-white/15 px-3 py-1 font-medium"
                        }
                      >
                        {ch.text}
                      </span>
                    ))}
                    {c.link && (
                      <Link
                        href={c.link.href}
                        className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 font-semibold text-white"
                      >
                        {c.link.label}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        ))}
      </div>
      {cards.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5 lg:hidden">
          {cards.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to card ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === active ? "w-5 bg-brand-600" : "w-1.5 bg-line"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

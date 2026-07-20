"use client";

import { Children, useRef, useState } from "react";

/**
 * A swipeable, snap-scrolling carousel with dot indicators — used for the
 * dashboard money cards (Owed / Received / Net), like a mobile banking home.
 * Each child is one full-width slide.
 */
export function HeroCarousel({ children }: { children: React.ReactNode }) {
  const slides = Children.toArray(children);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== active) setActive(Math.max(0, Math.min(slides.length - 1, i)));
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
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, i) => (
          <div key={i} className="w-full flex-none snap-center">
            {slide}
          </div>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {slides.map((_, i) => (
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

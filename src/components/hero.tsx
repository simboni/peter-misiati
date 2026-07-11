"use client";

import { useEffect, useRef, useState } from "react";
import { heroSlides } from "@/lib/cosdep";
import { Button, Pill } from "@/components/ui";
import { LeafIcon } from "@/components/icons";

/**
 * Home hero — a full-bleed crossfading photo slider of the field work, with
 * the mission headline overlaid. Auto-advances; pauses on hover/focus and
 * honours prefers-reduced-motion.
 */
export function Hero() {
  const [active, setActive] = useState(0);
  const paused = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => {
      if (!paused.current) setActive((i) => (i + 1) % heroSlides.length);
    }, 6000);
    return () => clearInterval(id);
  }, []);

  const slide = heroSlides[active];

  return (
    <section
      className="relative isolate overflow-hidden"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      aria-roledescription="carousel"
      aria-label="COSDEP in the field"
    >
      {/* Slides */}
      <div className="absolute inset-0 -z-10">
        {heroSlides.map((s, i) => (
          <div
            key={s.image}
            className={`slide absolute inset-0 ${i === active ? "slide-active" : ""}`}
            aria-hidden={i !== active}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.image}
              alt={i === active ? s.alt : ""}
              className="h-full w-full object-cover"
              loading={i === 0 ? "eager" : "lazy"}
            />
          </div>
        ))}
        {/* Legibility gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-forest-950/92 via-forest-950/70 to-forest-900/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-forest-950/70 via-transparent to-transparent" />
      </div>

      <div className="container-page flex min-h-[92vh] flex-col justify-center py-28 sm:min-h-[88vh]">
        <div className="max-w-2xl">
          <Pill tone="white" className="mb-6">
            <LeafIcon className="h-3.5 w-3.5" />
            {slide.kicker}
          </Pill>

          <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-white text-balance sm:text-5xl lg:text-[4rem]">
            {slide.title}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-forest-100/90 text-pretty sm:text-xl">
            {slide.body}
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Button href="/get-involved#donate" variant="leaf" size="lg" withArrow>
              Donate today
            </Button>
            <Button href="/programs" variant="white" size="lg">
              Our programmes
            </Button>
          </div>
        </div>

        {/* Slide controls */}
        <div className="mt-14 flex items-center gap-2.5">
          {heroSlides.map((s, i) => (
            <button
              key={s.image}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show slide ${i + 1}: ${s.kicker}`}
              aria-current={i === active}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active
                  ? "w-9 bg-leaf-500"
                  : "w-4 bg-white/40 hover:bg-white/70"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

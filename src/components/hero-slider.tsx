"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ---------------------------------------------------------------------------
   The hero: dashboards, no prose.

   The page used to open on a headline, a paragraph, six chips and a stat
   strip — a whole screen of reading before the first picture, on a site whose
   argument is that you should be able to SEE the work. This replaces all of
   it with the screens themselves and two buttons.

   Built on CSS scroll-snap, so the track is a real scrollable element: it
   works with no JavaScript at all, it can be swiped on a phone the way every
   other carousel can, and the keyboard and screen-reader behaviour comes free
   from it being a scroll container rather than a pile of absolutely-positioned
   divs faded in and out.

   The JS only adds auto-advance on top, and takes itself out of the way the
   moment the visitor touches it — advancing a slide under someone's finger is
   the thing that makes a carousel feel broken.
--------------------------------------------------------------------------- */

export type HeroSlide = { src: string; alt: string };

const INTERVAL = 5000;

export function HeroSlider({ slides }: { slides: HeroSlide[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // Once someone scrolls, swipes or clicks a dot, the carousel stops moving
  // on its own for good. It is their page now.
  const [taken, setTaken] = useState(false);

  const goTo = useCallback((i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const slide = track.children[i] as HTMLElement | undefined;
    if (slide) track.scrollTo({ left: slide.offsetLeft, behavior: "smooth" });
  }, []);

  // Which slide is actually in view — read from the scroll position rather
  // than tracked separately, so a swipe and a dot click cannot disagree.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        setIndex(Math.max(0, Math.min(slides.length - 1, i)));
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      track.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [slides.length]);

  useEffect(() => {
    if (taken) return;
    // Somebody who has asked their system not to animate things did not ask
    // for a slideshow either.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      const track = trackRef.current;
      if (!track) return;
      // A background tab advancing invisibly only wastes battery.
      if (document.hidden) return;
      const next = (Math.round(track.scrollLeft / track.clientWidth) + 1) % slides.length;
      goTo(next);
    }, INTERVAL);
    return () => clearInterval(id);
  }, [taken, slides.length, goTo]);

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onPointerDown={() => setTaken(true)}
        onWheel={() => setTaken(true)}
        className="hide-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth"
        aria-roledescription="carousel"
        aria-label="Dashboards from systems running today"
      >
        {slides.map((s, i) => (
          <div key={s.src} className="w-full shrink-0 snap-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.src}
              alt={s.alt}
              width={1600}
              height={900}
              // The first slide is the largest thing above the fold on every
              // visit; the rest can wait until the track moves.
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              {...(i === 0 ? { fetchPriority: "high" as const } : {})}
              className="block aspect-[16/9] w-full object-cover object-top"
            />
          </div>
        ))}
      </div>

      {/* Dots. Buttons, not decoration — they move the track. */}
      <div className="mt-5 flex items-center justify-center gap-2.5">
        {slides.map((s, i) => (
          <button
            key={s.src}
            type="button"
            onClick={() => {
              setTaken(true);
              goTo(i);
            }}
            aria-label={`Show slide ${i + 1} of ${slides.length}`}
            aria-current={i === index}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === index ? "w-7 bg-green-400" : "w-1.5 bg-mist-600/50 hover:bg-mist-500"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

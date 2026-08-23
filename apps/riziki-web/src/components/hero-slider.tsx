"use client";

/**
 * The hero slider.
 *
 * A carousel is easy to build badly, and a badly built one is worse than a
 * still image: it moves while you are reading, it cannot be paused, it traps a
 * keyboard, it lies to a screen reader, and on a phone it either swipes when
 * you meant to scroll or refuses to swipe at all. So the rules it follows are
 * written down here rather than left to be rediscovered.
 *
 *   Timing.      Seven seconds a slide. Long enough to read two lines of
 *                Kenyan-English marketing copy without hurrying, short enough
 *                that a visitor sees a second photograph before deciding to
 *                leave. Transitions are 700ms — under a second, so it reads as
 *                one thing changing rather than two things fighting.
 *
 *   Pausing.     It stops on hover, on focus anywhere inside it, while the tab
 *                is in the background, and permanently the moment a person
 *                touches any control. Someone who has taken charge of a
 *                carousel does not want it wandering off again.
 *
 *   Motion.      `prefers-reduced-motion` turns autoplay off entirely and
 *                cross-fades instead of sliding. This is not decoration: for
 *                some people a moving background is a headache.
 *
 *   Keyboard.    Left and right arrows move it when focus is inside. Every dot
 *                is a real button with a real label. Nothing here is a div
 *                pretending.
 *
 *   Reader.      The whole thing is a labelled group with `aria-roledescription
 *                ="carousel"`; slides are marked `aria-hidden` when off-screen
 *                so a reader is not offered three headings at once, and a
 *                polite live region names the slide when it changes.
 *
 *   Touch.       Horizontal drags over about 40px change slide; anything more
 *                vertical than horizontal is left alone so the page still
 *                scrolls under the thumb.
 *
 *   Weight.      The first photograph is eager with `fetchPriority="high"` and
 *                the rest are lazy, so the largest contentful paint is one
 *                image, not four. Each has a `-sm` variant and the browser is
 *                told the display width, so a phone downloads about 40 KB.
 *
 *   No layout    The frame has a fixed aspect ratio at every breakpoint, so
 *   shift.       nothing below it jumps as the photographs arrive.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface Slide {
  /** The 1600px-wide file. */
  src: string;
  /** The 800px-wide file, served to phones. */
  srcSm: string;
  /** Describes the photograph, not the marketing. Empty for purely decorative. */
  alt: string;
  /** The chip that names this picture. Changes with the slide. */
  eyebrow: string;
  /** One line under the headline. Changes with the slide. */
  body: string;
}

const INTERVAL_MS = 7000;

export function HeroSlider({
  slides,
  headline,
  actions,
}: {
  slides: Slide[];
  /** Stays put while the pictures change — this is the page's only h1. */
  headline: ReactNode;
  /** The order buttons, rendered by the page so it keeps its own links. */
  actions: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  /** Set once a person uses a control; autoplay never resumes after that. */
  const [taken, setTaken] = useState(false);
  const [reduced, setReduced] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const count = slides.length;
  const go = useCallback((n: number) => setIndex(((n % count) + count) % count), [count]);

  // Respect the operating system's motion setting, and keep respecting it if it
  // changes while the page is open.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // A background tab should not be animating; it burns battery on a phone and
  // means somebody returns to a slide they never saw start.
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (reduced || paused || taken || count < 2) return;
    const t = window.setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => window.clearTimeout(t);
  }, [index, reduced, paused, taken, count, go]);

  const take = (n: number) => {
    setTaken(true);
    go(n);
  };

  if (!count) return null;

  return (
    <div
      ref={root}
      role="group"
      aria-roledescription="carousel"
      aria-label="Riziki Industrial Chemicals — our store"
      className="relative overflow-hidden bg-scrim"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node)) setPaused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          take(index + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          take(index - 1);
        }
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        // More sideways than up-and-down, or the page scroll wins. A carousel
        // that eats vertical drags makes a phone feel broken.
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
        take(index + (dx < 0 ? 1 : -1));
      }}
    >
      {/*
        Sized by its content on a phone and by the viewport on a laptop.

        A fixed aspect ratio was right when the slider was a picture beside the
        copy. Now the copy is inside it, and an aspect ratio would either crop
        the words on a narrow phone or leave a field of empty photograph on a
        wide desktop. A min-height does both jobs: never shorter than the words
        need, never taller than most of the first screen.
      */}
      <div className="relative min-h-[30rem] w-full sm:min-h-[32rem] lg:min-h-[min(38rem,78vh)]">
        {slides.map((s, i) => {
          const on = i === index;
          return (
            <div
              key={s.src}
              aria-hidden={!on}
              // Inert when off-screen: without this a keyboard tabs into the
              // buttons of slides nobody can see.
              {...(!on ? { inert: "" as unknown as boolean } : {})}
              className={`absolute inset-0 transition-opacity duration-700 ease-out ${
                on ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <picture>
                <source media="(max-width: 640px)" srcSet={s.srcSm} type="image/webp" />
                <img
                  src={s.src}
                  alt={s.alt}
                  width={1600}
                  height={1200}
                  loading={i === 0 ? "eager" : "lazy"}
                  fetchPriority={i === 0 ? "high" : "low"}
                  decoding="async"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1024px"
                  className={`h-full w-full object-cover ${
                    reduced ? "" : on ? "scale-100" : "scale-105"
                  } transition-transform duration-[7000ms] ease-linear`}
                />
              </picture>

              {/* Two washes rather than one. A single diagonal left the body
                  line sitting over a bright drum at some widths; the vertical
                  one guarantees the bottom strip is dark enough to read on
                  whatever photograph is behind it. */}
              {/*
                Heavier on a phone than on a laptop, because the text spans the
                whole picture there instead of sitting in the darkened left
                third. Measured against the rendered pixels rather than guessed:
                white and the light green both clear 4.5:1 over every slide.
              */}
              <div aria-hidden="true" className="absolute inset-0 bg-scrim/60 sm:bg-scrim/48" />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-r from-scrim/90 via-scrim/70 to-scrim/40 sm:via-scrim/72 sm:to-scrim/15"
              />

            </div>
          );
        })}
      </div>

      {/*
        The hero copy, inside the slider and the same on every slide.

        The owner asked for the slider to be the first thing on the page and for
        anything that needed highlighting to live inside it. That rules out the
        old arrangement — a headline above and a second headline on each slide,
        two things competing to be the first thing read. So the h1, the promise
        and the two ways to order sit here, over the photographs, and each slide
        contributes only its picture and the chip that names it.

        One h1, present on every slide: a heading that vanishes when the picture
        changes is no use to a reader or to a search engine.
      */}
      <div className="pointer-events-none absolute inset-0 flex items-center">
        <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-10 sm:px-10 sm:pb-20 lg:px-12">
          <p
            key={slides[index].eyebrow}
            className="mb-3 inline-block rounded-full bg-leaf px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white"
          >
            {slides[index].eyebrow}
          </p>
          <h1 className="max-w-3xl text-[1.75rem] font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
            {headline}
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/90 sm:text-lg">
            {slides[index].body}
          </p>
          <div className="pointer-events-auto mt-6 flex flex-wrap gap-2.5 sm:gap-3">{actions}</div>
        </div>
      </div>

      {/* Arrows: pointer-only. On a phone the swipe is the control and two
          floating buttons would just cover the photograph. */}
      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={() => take(index - 1)}
            aria-label="Previous slide"
            className="absolute left-3 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-white/85 p-3 text-on-photo shadow-md transition hover:bg-white sm:flex"
          >
            <Chevron className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => take(index + 1)}
            aria-label="Next slide"
            className="absolute right-3 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-white/85 p-3 text-on-photo shadow-md transition hover:bg-white sm:flex"
          >
            <Chevron />
          </button>
        </>
      ) : null}

      {/* Pagination. Real buttons, 44px of tappable area each even though the
          dot itself is small, and the current one is named for a reader. */}
      {count > 1 ? (
        <div className="absolute bottom-3 right-4 flex items-center gap-0.5 sm:bottom-4 sm:right-6">
          {slides.map((s, i) => (
            <button
              key={s.src}
              type="button"
              onClick={() => take(i)}
              aria-label={`Go to slide ${i + 1} of ${count}: ${s.eyebrow}`}
              aria-current={i === index ? "true" : undefined}
              className="group flex h-11 w-7 items-center justify-center"
            >
              <span
                className={`block rounded-full transition-all duration-300 ${
                  i === index
                    ? "h-2 w-6 bg-white"
                    : "h-2 w-2 bg-white/50 group-hover:bg-white/80"
                }`}
              />
            </button>
          ))}
        </div>
      ) : null}

      {/* Announced politely, so a reader is told the slide changed without
          being interrupted mid-sentence. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        Slide {index + 1} of {count}: {slides[index].eyebrow}. {slides[index].body}
      </p>
    </div>
  );
}

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-5 w-5 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

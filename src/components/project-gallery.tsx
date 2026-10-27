"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { railThumb, shotsOf, RAIL_WIDTH, type Shot, type Showcase } from "@/lib/showcase";
import {
  ArrowUpRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ExpandIcon,
  ExternalLinkIcon,
} from "@/components/icons";

/* ---------------------------------------------------------------------------
   One project, one frame.

   WHAT THIS REPLACES. Each project used to be a pile: a big hero screenshot,
   then a grid of two or three more underneath, every one in its own box at its
   own size. Four projects of that is sixteen separate frames down the home
   page, each a different shape, and the eye has to work out for itself which
   pictures belong to which client. It also made the page enormously tall, so
   the fourth project was a very long way from the first.

   WHAT IT IS NOW. Every project gets ONE stage — a fixed browser frame that
   does not change size — and all of that project's screens load into it, one
   at a time, picked from a strip of thumbnails underneath. The words sit
   beside it and stay put while the pictures change, so the description and the
   screen it describes are on screen together.

   THE STAGE NEVER RESIZES. This is the whole trick and it is not cosmetic. The
   shots are 1440x900, 1300x1200, 760x1645 — a desktop admin, a tall settings
   page, a phone. If the frame took each image's shape, every click would shove
   the rest of the page up or down under the reader's cursor. So the stage is a
   fixed 16:10 mat and the image is centred inside it at whatever size fits.
   A phone screenshot shows as a tall narrow image on a wide mat, which is
   exactly what a phone screenshot is.

   WHAT LOADS, AND WHEN. Only the opening screen of each gallery is fetched
   with the page; the other three are not in the DOM at all until somebody
   reaches for them. Hovering, focusing or touching a thumbnail starts the
   fetch before the click lands, so switching feels instant, and once a visitor
   has opened any screen in a gallery the rest of that gallery is fetched in
   the background — they have shown what they came for. That takes the home
   page from sixteen full screenshots on arrival to four. A thumbnail uses the
   SAME file as the stage, at a smaller size, so a screen never costs two
   downloads.
--------------------------------------------------------------------------- */

/* --------------------------- loading bookkeeping ------------------------ */

/** Which shots this gallery has been asked for. Index 0 is always wanted. */
function useWanted(count: number) {
  const [wanted, setWanted] = useState<readonly number[]>([0]);
  const want = useCallback((i: number) => {
    setWanted((w) => (w.includes(i) ? w : [...w, i]));
  }, []);
  /** Everything, for when the visitor has committed (opened the lightbox). */
  const wantAll = useCallback(() => {
    setWanted((w) => (w.length === count ? w : Array.from({ length: count }, (_, i) => i)));
  }, [count]);
  return { wanted, want, wantAll };
}

/* -------------------------------- the image ----------------------------- */

/**
 * One screen on the mat.
 *
 * `object-contain` with no cropping: these are screenshots, and a screenshot
 * cropped to fit a box is a screenshot with the number cut off it.
 */
function Stage({ shot, on, priority }: { shot: Shot; on: boolean; priority: boolean }) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center p-3 transition-opacity duration-300 sm:p-5 ${
        on ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!on}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={shot.src}
        alt={shot.alt}
        width={shot.width}
        height={shot.height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        {...(priority ? { fetchPriority: "high" as const } : {})}
        className={`h-auto max-h-full w-auto max-w-full object-contain shadow-[0_18px_45px_-28px_rgba(0,0,0,0.8)] ${
          // A phone shot gets a hint of a device edge. Without it a tall
          // narrow image on a wide mat just reads as a cropping mistake.
          shot.phone
            ? "rounded-[1.4rem] border-[5px] border-ink-600"
            : "rounded-md border border-ink-700"
        }`}
      />
    </div>
  );
}

/* -------------------------------- lightbox ------------------------------ */

/**
 * Expanded view, on a native <dialog>.
 *
 * `showModal()` puts this in the browser's top layer, so it is above the
 * sticky header and above anything else on the page without a single z-index,
 * and it cannot be clipped by an ancestor's transform or overflow. Escape to
 * close and the focus trap come with it rather than being reimplemented, which
 * is the part hand-rolled lightboxes usually get wrong.
 */
function Lightbox({
  shots,
  index,
  client,
  onIndex,
  onClose,
}: {
  shots: Shot[];
  index: number;
  client: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const swipeFrom = useRef<number | null>(null);
  const shot = shots[index];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    // showModal makes the page inert but does not stop it scrolling behind.
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (el.open) el.close();
    };
  }, []);

  const step = (d: number) => onIndex((index + d + shots.length) % shots.length);

  return (
    <dialog
      ref={ref}
      // `close` fires for Escape as well as for our own close(), so the React
      // state is kept in step with the element whichever way it was dismissed.
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        // Only a click on the backdrop itself. Clicks on the image, the
        // caption or the buttons bubble from children and are left alone.
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      }}
      aria-label={`${client} — screen ${index + 1} of ${shots.length}`}
      className="h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/90 backdrop:backdrop-blur-sm"
    >
      <div className="pointer-events-none flex h-full w-full flex-col">
        {/* Bar */}
        <div className="pointer-events-auto flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <p className="min-w-0 truncate font-mono text-xs uppercase tracking-[0.16em] text-white/70">
            {client} &middot; {index + 1}/{shots.length}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the expanded view"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/20 text-white/80 transition-colors hover:border-white/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* The screen, as big as the viewport allows */}
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16"
          // Swipe. The arrows are a pointer affordance and are hidden on a
          // phone, so without this the only way forward on the screen most
          // visitors are holding would be the dots underneath.
          onTouchStart={(e) => { swipeFrom.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const from = swipeFrom.current;
            swipeFrom.current = null;
            if (from === null) return;
            const dx = e.changedTouches[0].clientX - from;
            // 48px, so a slightly crooked tap is not read as a swipe.
            if (Math.abs(dx) > 48) step(dx < 0 ? 1 : -1);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shot.src}
            alt={shot.alt}
            width={shot.width}
            height={shot.height}
            decoding="async"
            className="pointer-events-auto h-auto max-h-full w-auto max-w-full rounded-lg object-contain"
          />
          {shots.length > 1 && (
            <>
              <Arrow side="left" onClick={() => step(-1)} />
              <Arrow side="right" onClick={() => step(1)} />
            </>
          )}
        </div>

        {/* Caption and the film strip */}
        <div className="pointer-events-auto px-4 pb-4 pt-3 sm:px-6 sm:pb-6">
          <p className="text-center text-sm text-white/80">{shot.caption}</p>
          {shots.length > 1 && (
            // The dot is 6px; the button around it is 32 tall, because a 6px
            // tap target on a phone is a tap target nobody can hit.
            <div className="mt-1 flex justify-center">
              {shots.map((s, i) => (
                <button
                  key={s.src}
                  type="button"
                  onClick={() => onIndex(i)}
                  aria-label={s.caption}
                  aria-current={i === index}
                  className="group/dot flex h-8 items-center px-1.5 focus-visible:outline-none"
                >
                  <span
                    className={`block h-1.5 rounded-full transition-all duration-300 group-focus-visible/dot:ring-2 group-focus-visible/dot:ring-green-400 ${
                      i === index ? "w-8 bg-green-400" : "w-4 bg-white/30 group-hover/dot:bg-white/60"
                    }`}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

function Arrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous screen" : "Next screen"}
      className={`pointer-events-auto absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white/80 transition-colors hover:border-white/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 sm:flex ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      <Icon className="h-6 w-6" />
    </button>
  );
}

/* -------------------------------- gallery ------------------------------- */

export function ProjectGallery({ item, index }: { item: Showcase; index: number }) {
  const shots = shotsOf(item);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const { wanted, want, wantAll } = useWanted(shots.length);

  // Once a visitor has switched screens in this gallery, quietly fetch the
  // rest of it: they are looking, and the next click should not wait.
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (!engaged) return;
    const id = setTimeout(wantAll, 400);
    return () => clearTimeout(id);
  }, [engaged, wantAll]);

  const select = useCallback(
    (i: number) => {
      want(i);
      setActive(i);
      setEngaged(true);
    },
    [want],
  );

  const wordsRight = index % 2 === 1;
  const shot = shots[active];

  return (
    <article className="border-t border-ink-700 py-14 first:border-t-0 sm:py-20">
      <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
        {/* ----------------------------- Words ---------------------------- */}
        {/* min-w-0 on both columns is load-bearing, not tidying. A grid track
            is sized to its content's minimum by default, and the thumbnail
            strip is four 112px tiles in a row — 484px. On a 420px phone that
            widened the whole grid past the viewport and pushed the expand
            button off the right-hand edge, taking the words with it. */}
        <div className={`min-w-0 lg:col-span-4 ${wordsRight ? "lg:order-2" : ""}`}>
          <h3 className="font-display text-3xl font-bold leading-tight tracking-tight text-mist-100 sm:text-4xl">
            {item.client}
          </h3>
          <p className="mt-4 text-lg leading-relaxed text-mist-400 text-pretty">
            {item.outcome}
          </p>

          {/* What is in the frame right now, in words. It lives in the
              description column rather than under the picture so that the
              sentence and the screen it is about are read together, and it is
              a live region so a screen reader hears it change. */}
          <p
            aria-live="polite"
            className="mt-5 flex items-start gap-2.5 border-l-2 border-green-400/60 pl-3 text-sm leading-relaxed text-mist-300"
          >
            <span className="shrink-0 font-mono text-xs text-green-400">
              {active + 1}/{shots.length}
            </span>
            <span>{shot.caption}</span>
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
              href={`/work/${item.slug}`}
              prefetch={false}
              className="inline-flex items-center gap-1 text-sm font-semibold text-mist-500 underline-offset-4 hover:text-mist-200 hover:underline"
            >
              How it was built
              <ArrowUpRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* ---------------------------- The frame -------------------------- */}
        <div className={`min-w-0 lg:col-span-8 ${wordsRight ? "lg:order-1" : ""}`}>
          <div className="overflow-hidden rounded-xl border border-ink-600 bg-ink-800 shadow-[0_24px_60px_-35px_rgba(0,0,0,0.6)]">
            {/* Browser chrome. A screenshot in a window bar reads as a product;
                the same file loose on the page reads as a picture. */}
            <div className="flex items-center gap-2 border-b border-ink-600 bg-ink-850 px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-ink-500" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-ink-500" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-ink-500" aria-hidden />
              <span className="ml-2 min-w-0 flex-1 truncate font-mono text-[0.68rem] text-mist-600">
                {item.liveLabel}
              </span>
              <button
                type="button"
                onClick={() => { wantAll(); setExpanded(true); }}
                aria-label={`Expand ${item.client} — ${shot.caption}`}
                // -my-1 buys a 36px touch target out of the chrome bar's own
                // padding, without making the bar taller than a browser's.
                className="-mr-1 -my-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-mist-500 transition-colors hover:bg-ink-700 hover:text-green-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
              >
                <ExpandIcon className="h-4 w-4" />
              </button>
            </div>

            {/* The mat. Fixed shape, so nothing below it moves when the
                picture changes. bg-grid shows through while a screen that has
                not been fetched yet is on its way. */}
            <div
              className="relative aspect-[16/10] bg-ink-900"
              role="group"
              aria-roledescription="gallery"
              aria-label={`${item.client} — ${shots.length} screens`}
            >
              <div className="absolute inset-0 bg-grid opacity-[0.35]" aria-hidden />
              {shots.map((s, i) =>
                wanted.includes(i) ? (
                  <Stage
                    key={s.src}
                    shot={s}
                    on={i === active}
                    // Exactly one image on the whole page is eager: the one
                    // sitting in the first gallery's frame.
                    priority={index === 0 && i === 0}
                  />
                ) : null,
              )}
              <button
                type="button"
                onClick={() => { wantAll(); setExpanded(true); }}
                aria-label={`Expand ${item.client} — ${shot.caption}`}
                className="absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-400"
              />
            </div>
          </div>

          {/* --------------------------- Thumbnails ------------------------ */}
          {/* Scrolls sideways rather than wrapping: a second row of thumbnails
              under a fixed stage puts the next project's words at a different
              height for every gallery. */}
          <div className="hide-scrollbar mt-4 flex gap-3 overflow-x-auto pb-1">
            {shots.map((s, i) => {
              const on = i === active;
              return (
                <button
                  key={s.src}
                  type="button"
                  onClick={() => select(i)}
                  // Start the fetch on the first sign of interest, so the
                  // picture is usually there before the click arrives. Touch
                  // has no hover, which is what pointerdown covers.
                  onMouseEnter={() => want(i)}
                  onFocus={() => want(i)}
                  onPointerDown={() => want(i)}
                  aria-label={s.caption}
                  aria-current={on}
                  className={`group relative h-16 w-28 shrink-0 overflow-hidden rounded-lg border bg-ink-900 transition-all sm:h-20 sm:w-36 ${
                    on
                      ? "border-green-400 ring-1 ring-green-400/40"
                      : "border-ink-600 opacity-60 hover:opacity-100 focus-visible:opacity-100"
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400`}
                >
                  {/* 320px, from public/rail — not the 1600px original. The
                      button already carries the caption as its label, so the
                      image itself is decorative and takes an empty alt. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={railThumb(s.src)}
                    alt=""
                    width={RAIL_WIDTH}
                    height={Math.round((RAIL_WIDTH * s.height) / s.width)}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover object-top"
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {expanded && (
        <Lightbox
          shots={shots}
          index={active}
          client={item.client}
          onIndex={select}
          onClose={() => setExpanded(false)}
        />
      )}
    </article>
  );
}

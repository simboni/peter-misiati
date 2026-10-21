import type { Shot } from "@/lib/showcase";

/* ---------------------------------------------------------------------------
   Chrome around a screenshot.

   A bare PNG on a page reads as a picture. The same PNG inside a browser bar
   reads as a product — the frame is what tells the eye "this is a thing that
   runs", and it costs nothing but a border and three dots.

   width/height are always passed through to the <img>. Without them the
   browser does not know the shape until the bytes arrive, and a page that is
   mostly images becomes a page that jumps around while it loads — which on a
   web developer's own site is an advertisement for the wrong thing.

   Plain <img> rather than next/image on purpose: this site is `output:
   "export"` with `images: { unoptimized: true }`, so next/image would add a
   wrapper and buy nothing. The screens are pre-compressed to WebP instead.
--------------------------------------------------------------------------- */

export function BrowserFrame({
  shot,
  url,
  priority = false,
  /** Cap the height and crop from the top, so a row of proof shots lines up
      instead of one tall screenshot setting the height for all of them. */
  compact = false,
  className = "",
}: {
  shot: Shot;
  url?: string;
  /** The one image above the fold loads eagerly; everything else waits. */
  priority?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <figure className={`group overflow-hidden rounded-xl border border-ink-600 bg-ink-800 shadow-[0_24px_60px_-35px_rgba(0,0,0,0.6)] ${className}`}>
      <div className="flex items-center gap-2 border-b border-ink-600 bg-ink-850 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-ink-500" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-500" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-500" aria-hidden />
        {url && (
          <span className="ml-2 truncate font-mono text-[0.68rem] text-mist-600">{url}</span>
        )}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={shot.src}
        alt={shot.alt}
        width={shot.width}
        height={shot.height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        {...(priority ? { fetchPriority: "high" as const } : {})}
        className={`block w-full ${compact ? "max-h-[360px] object-cover object-top" : ""}`}
      />
      <figcaption className="border-t border-ink-600 bg-ink-850 px-4 py-2.5 text-sm text-mist-400">
        {shot.caption}
      </figcaption>
    </figure>
  );
}

export function PhoneFrame({
  shot,
  compact = false,
  className = "",
}: {
  shot: Shot;
  compact?: boolean;
  className?: string;
}) {
  return (
    <figure className={`flex flex-col items-center ${className}`}>
      <div className="overflow-hidden rounded-[1.75rem] border-[6px] border-ink-600 bg-ink-800 shadow-[0_24px_60px_-35px_rgba(0,0,0,0.6)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shot.src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          loading="lazy"
          decoding="async"
          className={`block w-full ${compact ? "max-w-[208px]" : "max-w-[260px]"}`}
        />
      </div>
      <figcaption className={`mt-3 text-center text-sm text-mist-400 ${compact ? "max-w-[208px]" : "max-w-[260px]"}`}>
        {shot.caption}
      </figcaption>
    </figure>
  );
}

/** Either frame, chosen by the shot itself. */
export function Screen({
  shot,
  url,
  priority,
  compact,
  className,
}: {
  shot: Shot;
  url?: string;
  priority?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return shot.phone ? (
    <PhoneFrame shot={shot} compact={compact} className={className} />
  ) : (
    <BrowserFrame shot={shot} url={url} priority={priority} compact={compact} className={className} />
  );
}

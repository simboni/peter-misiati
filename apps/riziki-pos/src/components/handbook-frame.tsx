"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The handbook's frame, sized to whatever space is actually left for it.
 *
 * This is measured rather than calculated because the chrome around it is not a
 * constant: the header is 68px on a laptop and ~78px on a phone, where the shop
 * name wraps to two lines, and it would grow again for a longer name or a larger
 * text setting. A hard-coded height is wrong on some device the shop owns.
 *
 * Getting it exact matters more here than on a normal screen. The handbook is a
 * whole scrolling document with a contents rail stuck to the top of its own
 * viewport; if the frame is even slightly taller than the space available, the
 * page behind it scrolls too, and a thumb-drag lands on whichever of the two
 * happens to be under the thumb. One scrolling thing, exactly fitted.
 *
 * Before this runs — and if scripting is off — the CSS height below is a close
 * enough first paint that nothing visibly jumps.
 */
export default function HandbookFrame({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;

    const fit = () => {
      // Distance from the top of the page to the top of this box: everything
      // the app is putting above the handbook, whatever that turns out to be.
      const top = el.getBoundingClientRect().top + window.scrollY;

      // The phone's tab bar floats over the bottom of the page, so the space it
      // covers is not ours to fill. On a desktop it isn't rendered and the rail
      // takes over, so there is nothing to subtract.
      const bar = document.querySelector<HTMLElement>("[data-bottom-bar]");
      const covered = bar && getComputedStyle(bar).display !== "none" ? bar.offsetHeight : 0;

      // A floor, so a freak measurement can never collapse the handbook to a
      // sliver with no way to scroll it.
      const next = Math.max(320, Math.round(window.innerHeight - top - covered));
      // Only react to real changes: this resizes the box, which is itself what
      // the observer below is watching.
      setHeight((current) => (current !== null && Math.abs(current - next) < 2 ? current : next));
    };

    fit();

    // Catches the rotations and the rail collapsing, but also the subtler one:
    // the header growing a line at a narrow width.
    const observer = new ResizeObserver(fit);
    observer.observe(document.documentElement);
    window.addEventListener("resize", fit);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <div
      ref={box}
      style={height === null ? undefined : { height }}
      className="h-[calc(100dvh-4.25rem)]"
    >
      <iframe src={src} title="My handbook" className="h-full w-full border-0 bg-white" />
    </div>
  );
}

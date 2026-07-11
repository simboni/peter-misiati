"use client";

import { useEffect, useRef, useState } from "react";

/** Counts from 0 to `end` once, when scrolled into view. */
export function CountUp({
  end,
  suffix = "",
  duration = 1400,
  className = "",
}: {
  end: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            if (reduce) {
              setValue(end);
              io.disconnect();
              return;
            }
            const start = performance.now();
            const tick = (now: number) => {
              const p = Math.min(1, (now - start) / duration);
              const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
              setValue(Math.round(end * eased));
              if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            io.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [end, duration]);

  return (
    <span ref={ref} className={className}>
      {value.toLocaleString("en-US")}
      {suffix}
    </span>
  );
}

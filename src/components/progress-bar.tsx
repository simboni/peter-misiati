"use client";

import { useEffect, useRef, useState } from "react";

const accentBar: Record<string, string> = {
  terra: "bg-terra-500",
  gold: "bg-gold-400",
  sky: "bg-sky-500",
  sage: "bg-sage-600",
};

/**
 * Animated progress meter for causes. The fill grows from 0 → value the first
 * time it scrolls into view; static under prefers-reduced-motion.
 */
export function ProgressBar({
  value,
  accent = "terra",
  label = "Funded",
}: {
  value: number;
  accent?: "terra" | "gold" | "sky" | "sage";
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-ink-700">{label}</span>
        <span className="font-display text-lg font-semibold text-ink-900">{value}%</span>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-cream-200">
        <div
          className={`progress-fill h-full rounded-full ${accentBar[accent]}`}
          style={{ ["--to" as string]: shown ? value / 100 : 0 }}
        />
      </div>
    </div>
  );
}

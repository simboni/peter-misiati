import Link from "next/link";

/**
 * KEYSA wordmark, redrawn from the official logo as theme-aware text:
 * green "Ke", red "Y", and "SA" in the current heading colour, over the
 * association's full name. Scales crisply at any size, works on dark.
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="KEYSA — Kenya Youth Support Association, home"
      className="group inline-flex items-center gap-3"
    >
      {/* Emblem: rising person inside a shield-leaf, flag colours */}
      <svg
        viewBox="0 0 40 40"
        className="h-9 w-9 shrink-0"
        aria-hidden
        fill="none"
      >
        <path
          d="M20 3c5 3 9.5 4 15 4v12c0 9-6.5 15.5-15 18C11.5 34.5 5 28 5 19V7c5.5 0 10-1 15-4Z"
          className="fill-green-400"
        />
        <path
          d="M20 8.5a3.1 3.1 0 1 1 0 6.2 3.1 3.1 0 0 1 0-6.2Z"
          fill="#fff"
        />
        <path
          d="M13.5 25.5c.8-4.4 3.2-7 6.5-7s5.7 2.6 6.5 7c-1.9 2.4-4 4.2-6.5 5.4-2.5-1.2-4.6-3-6.5-5.4Z"
          fill="#fff"
        />
      </svg>
      <span className="leading-none">
        <span className="font-display text-xl font-bold tracking-tight">
          <span className="text-green-400">Ke</span>
          <span className="text-accent-400">Y</span>
          <span className="text-mist-100">SA</span>
        </span>
        {!compact && (
          <span className="mt-1 block text-[0.62rem] font-medium tracking-[0.08em] text-mist-500">
            Kenya Youth Support Association
          </span>
        )}
      </span>
    </Link>
  );
}

import Link from "next/link";
import { profile } from "@/lib/portfolio";

/**
 * SMP brand mark — a code-tag monogram in emerald green.
 *   <LogoMark>  the "</>" glyph in a green-ringed tile (also the avatar/favicon)
 *   <Logo>      the full lockup: mark + name + ~/smp-developers, links home
 */

export function LogoMark({
  className = "",
  uid = "smp",
}: {
  className?: string;
  /** Unique suffix for the gradient ids — override when several marks share a page. */
  uid?: string;
}) {
  const ring = `${uid}-ring`;
  const glyph = `${uid}-glyph`;
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={`${profile.name} logo`}
    >
      <defs>
        <linearGradient id={ring} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3ff59a" />
          <stop offset="1" stopColor="#159a57" />
        </linearGradient>
        <linearGradient id={glyph} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8ff7c2" />
          <stop offset="1" stopColor="#2ee88a" />
        </linearGradient>
      </defs>
      {/* Terminal tile with a gradient ring */}
      <rect
        x="3"
        y="3"
        width="94"
        height="94"
        rx="24"
        fill="#0e1512"
        stroke={`url(#${ring})`}
        strokeWidth="3"
      />
      {/* Subtle inner top highlight for depth */}
      <rect x="8" y="8" width="84" height="40" rx="19" fill="#ffffff" opacity="0.03" />
      {/* The </> mark, redrawn as clean geometric strokes */}
      <g
        fill="none"
        stroke={`url(#${glyph})`}
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M37 36 L23 50 L37 64" />
        <path d="M63 36 L77 50 L63 64" />
        <path d="M56 33 L44 67" />
      </g>
    </svg>
  );
}

// Alias kept for the favicon/tiny contexts.
export const LogoBadge = LogoMark;

export function Logo({
  className = "",
  uid = "smp",
}: {
  className?: string;
  uid?: string;
}) {
  return (
    <Link
      href="/"
      className={`group flex min-w-0 items-center gap-2 sm:gap-2.5 ${className}`}
      aria-label="SMP Developers — home"
    >
      <LogoMark
        uid={uid}
        className="h-7 w-7 shrink-0 rounded-[0.5rem] transition-transform duration-300 group-hover:-translate-y-0.5 sm:h-9 sm:w-9 sm:rounded-[0.6rem]"
      />
      <span className="truncate whitespace-nowrap font-mono text-[0.95rem] font-semibold tracking-tight sm:text-xl">
        <span className="text-mist-600">~/</span>
        <span className="text-green-400">smp-developers</span>
      </span>
    </Link>
  );
}

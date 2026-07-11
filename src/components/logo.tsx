import Link from "next/link";

/**
 * Official congregation lockup — the Canossian crest with "Figlie della
 * Carità Canossiane". The PNG has a transparent background, so it sits
 * directly on the cream header; on dark surfaces (`invert`) it is placed on
 * a light rounded chip so the black lettering stays legible. Explicit
 * width/height prevent layout shift; sizes stay compact on small screens.
 */
export function Logo({
  className = "",
  invert = false,
}: {
  /** kept for API compatibility with earlier call sites */
  uid?: string;
  className?: string;
  invert?: boolean;
}) {
  return (
    <Link
      href="/"
      className={`group inline-flex shrink-0 items-center ${className}`}
      aria-label="Canossian Sisters — Figlie della Carità Canossiane — home"
    >
      <span
        className={
          invert
            ? "inline-flex items-center rounded-xl bg-cream-50 px-3 py-1.5 shadow-sm"
            : "inline-flex items-center"
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/logo.png"
          alt="Figlie della Carità Canossiane"
          width={417}
          height={230}
          decoding="async"
          className="h-12 w-auto max-w-full select-none transition-transform duration-300 group-hover:-translate-y-0.5 sm:h-14"
        />
      </span>
    </Link>
  );
}

export function Mark({ uid = "logo", className = "" }: { uid?: string; className?: string }) {
  const g = `${uid}-shield`;
  return (
    <svg
      viewBox="0 0 44 48"
      className={`h-10 w-9 shrink-0 transition-transform duration-300 group-hover:-translate-y-0.5 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6c877" />
          <stop offset="1" stopColor="#c08a2e" />
        </linearGradient>
      </defs>
      {/* Shield */}
      <path
        d="M22 2 40 7v16c0 12-8 19-18 23C12 42 4 35 4 23V7L22 2Z"
        fill={`url(#${g})`}
        stroke="#8a4a1a"
        strokeWidth="1.4"
      />
      {/* inner field */}
      <path
        d="M22 6 36 9.8V23c0 9.6-6.2 15.4-14 18.8C14.2 38.4 8 32.6 8 23V9.8L22 6Z"
        fill="#faf1e8"
      />
      {/* Sacred Heart */}
      <path
        d="M22 32s-7-4.3-7-9.4a3.9 3.9 0 0 1 7-2.3 3.9 3.9 0 0 1 7 2.3C29 27.7 22 32 22 32Z"
        fill="#a12e2a"
      />
      {/* cross rising from the heart */}
      <path d="M22 20V13M19.4 15.4h5.2" stroke="#c08a2e" strokeWidth="1.5" strokeLinecap="round" />
      {/* flame tip */}
      <path d="M22 12.6c1.1-1 1-2.4.4-3.4.9.3 2 1.4 2 2.9" fill="#d9a441" />
    </svg>
  );
}

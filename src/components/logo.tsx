import Link from "next/link";

/**
 * Canossian crest-inspired mark: a gold shield bearing the Sacred Heart and a
 * cross — the heart of the congregation's charism — paired with a serif
 * wordmark. `uid` keeps gradient ids unique when multiple logos render.
 */
export function Logo({
  uid = "logo",
  className = "",
  invert = false,
}: {
  uid?: string;
  className?: string;
  invert?: boolean;
}) {
  const wordColor = invert ? "text-cream-50" : "text-ink-900";
  const subColor = invert ? "text-cream-200/80" : "text-terra-500";
  return (
    <Link href="/" className={`group inline-flex items-center gap-3 ${className}`} aria-label="Canossian Sisters — home">
      <Mark uid={uid} />
      <span className="flex flex-col leading-none">
        <span className={`font-display text-[1.15rem] font-semibold tracking-tight ${wordColor}`}>
          Canossian Sisters
        </span>
        <span className={`mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.22em] ${subColor}`}>
          North East Africa
        </span>
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

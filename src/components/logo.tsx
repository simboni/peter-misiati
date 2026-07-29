import Link from "next/link";

/**
 * KEYSA wordmark, redrawn from the official logo as theme-aware SVG + text:
 * black "K" with its keyhole cut-out, red "e", green "Y", black "SA" —
 * the keyhole emblem carries the logo's key motif. Crisp at any size,
 * legible on both themes.
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="KEYSA — Kenya Youth Support Association, home"
      className="group inline-flex items-center gap-3"
    >
      {/* Emblem: the keyhole from the official logo's "K" */}
      <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0" aria-hidden fill="none">
        <rect width="40" height="40" rx="9" className="fill-mist-100" />
        <circle cx="20" cy="15.5" r="6" className="fill-ink-900" />
        <path d="M20 18.5 26 31.5H14L20 18.5Z" className="fill-ink-900" />
        {/* key bit peeking through, in brand red */}
        <path
          d="M24.5 24.5h6v2.4h-2v2h-2v-2h-2v-2.4Z"
          className="fill-accent-400"
        />
      </svg>
      <span className="leading-none">
        <span className="font-display text-xl font-bold tracking-tight">
          <span className="text-mist-100">K</span>
          <span className="text-accent-400">e</span>
          <span className="text-green-400">Y</span>
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

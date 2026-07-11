import Link from "next/link";
import { site } from "@/lib/cosdep";

/**
 * COSDEP wordmark — the real circular logo alongside the acronym and a short
 * descriptor. `compact` drops the descriptor (used in tight footers).
 */
export function Logo({
  compact = false,
  onDark = false,
}: {
  compact?: boolean;
  onDark?: boolean;
}) {
  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-3"
      aria-label={`${site.name} — home`}
    >
      <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-forest-100 shadow-soft transition-transform duration-300 group-hover:-translate-y-0.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/cosdep-logo.png"
          alt=""
          width={44}
          height={44}
          className="h-full w-full object-contain"
        />
      </span>
      <span className="flex flex-col leading-none">
        <span
          className={`font-display text-lg font-extrabold tracking-tight ${
            onDark ? "text-white" : "text-forest-800"
          }`}
        >
          {site.name}
        </span>
        {!compact && (
          <span
            className={`mt-1 hidden text-[0.6rem] font-semibold uppercase tracking-[0.14em] sm:block ${
              onDark ? "text-forest-100/70" : "text-ink-400"
            }`}
          >
            Sustainable Development
          </span>
        )}
      </span>
    </Link>
  );
}

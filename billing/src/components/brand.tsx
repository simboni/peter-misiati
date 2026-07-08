import Link from "next/link";

export const APP_NAME = "Tally";
export const APP_TAGLINE = "Invoicing & billing, made simple.";

/**
 * The Tally mark: two tally strokes resolving into a checkmark — "counted → paid".
 * Container-less emerald glyph; pairs with the wordmark's emerald "ll".
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-brand-600"
      aria-hidden
    >
      <line x1="16" y1="20" x2="16" y2="44" />
      <line x1="26" y1="20" x2="26" y2="44" />
      <path d="M34 35 L42 44 L54 20" />
    </svg>
  );
}

/**
 * Wordmark: the "ll" picks up the mark's emerald, echoing the tally strokes.
 * The base letters inherit `currentColor`, so it reads correctly on light and
 * dark backgrounds alike — set the colour on the parent (e.g. text-ink / text-white).
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      Ta<span className="text-brand-600">ll</span>y
    </span>
  );
}

export function Brand({
  href = "/",
  size = 30,
  className = "text-ink",
}: {
  href?: string;
  size?: number;
  className?: string;
}) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 ${className}`}>
      <BrandMark size={size} />
      <Wordmark className="text-lg" />
    </Link>
  );
}

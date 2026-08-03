import Link from "next/link";

export const APP_NAME = "TallyPay";
export const APP_TAGLINE = "Invoicing & M-Pesa payments, made simple.";

// The theme emerald (brand-600). Hard-coded on the mark so the badge renders
// identically everywhere — app chrome, print, PDF and email — regardless of CSS.
const BRAND_EMERALD = "#059669";

/**
 * The TallyPay mark: two tally strokes resolving into a checkmark
 * ("counted → paid"), set in white on a rounded emerald badge — the same tile
 * as the favicon, so the icon reads consistently at every size and on any
 * background (light or dark).
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="17" fill={BRAND_EMERALD} />
      <g fill="none" stroke="#fff" strokeWidth={6.5} strokeLinecap="round" strokeLinejoin="round">
        <line x1="20" y1="22" x2="20" y2="42" />
        <line x1="29" y1="22" x2="29" y2="42" />
        <path d="M36 34 L43 42 L52 22" />
      </g>
    </svg>
  );
}

/**
 * Wordmark: "Tally" in the surrounding ink/white, "Pay" in the theme emerald —
 * a two-tone lockup that ties the wordmark to the badge. The base letters
 * inherit `currentColor`, so set the colour on the parent (text-ink / text-white).
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      Tally<span className="text-brand-600">Pay</span>
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

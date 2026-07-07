import Link from "next/link";

export const APP_NAME = "Tally";
export const APP_TAGLINE = "Invoicing & billing, made simple.";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg bg-brand-600 font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      aria-hidden
    >
      T
    </span>
  );
}

export function Brand({ href = "/", size = 32 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2">
      <BrandMark size={size} />
      <span className="text-lg font-bold tracking-tight text-ink">{APP_NAME}</span>
    </Link>
  );
}

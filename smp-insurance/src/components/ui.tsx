import Link from "next/link";

/** Shared layout + CTA primitives so every page stays visually consistent. */

export function Container({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "center",
  dark = false,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  align?: "left" | "center";
  dark?: boolean;
}) {
  const alignCls = align === "center" ? "text-center mx-auto" : "text-left";
  return (
    <div className={`max-w-2xl ${alignCls}`}>
      {eyebrow ? (
        <p
          className={`text-xs font-bold uppercase tracking-[0.18em] ${
            dark ? "text-navy-300" : "text-navy-500"
          }`}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={`mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl ${
          dark ? "text-white" : "text-slate-900"
        }`}
      >
        {title}
      </h2>
      {lead ? (
        <p className={`mt-4 text-base leading-relaxed sm:text-lg ${dark ? "text-navy-200" : "text-slate-500"}`}>
          {lead}
        </p>
      ) : null}
    </div>
  );
}

/* CTA button styles — amber is reserved for primary actions only. */
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-cta-500 px-6 py-3.5 font-display text-base font-bold text-navy-950 shadow-lg shadow-cta-500/25 transition hover:bg-cta-400 active:scale-[0.98]";

export const btnWhatsApp =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 py-3.5 font-display text-base font-bold text-[#073b1c] shadow-lg shadow-[#25D366]/25 transition hover:brightness-105 active:scale-[0.98]";

export const btnDark =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-6 py-3.5 font-display text-base font-bold text-white transition hover:bg-navy-800 active:scale-[0.98]";

export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-paper-400 bg-paper-50 px-6 py-3.5 font-display text-base font-bold text-navy-900 transition hover:border-navy-400 hover:bg-navy-50 active:scale-[0.98]";

export const btnOutlineOnDark =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 px-6 py-3.5 font-display text-base font-bold text-white transition hover:bg-white/10 active:scale-[0.98]";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-paper-300 bg-paper-50 p-6 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function TextLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`font-semibold text-navy-600 underline-offset-4 transition hover:text-navy-500 hover:underline ${className}`}
    >
      {children}
    </Link>
  );
}

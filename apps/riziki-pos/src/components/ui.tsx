/**
 * Shared building blocks. Every module uses these so the system looks like one
 * product rather than ten screens by ten different hands.
 *
 * The design language ("quiet teal"): white cards float on a teal-washed
 * canvas with soft tinted shadows instead of grey borders; the deep-pine tone
 * is reserved for titles and headline money; the teal-to-leaf "thread" appears
 * only as a 3px accent. Every text/background pair here has been checked to
 * WCAG AA or better — this runs in sunlight on cheap Androids.
 */

import Link from "next/link";
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-3xl bg-white p-4 shadow-card ring-1 ring-ink/5 xl:p-4 2xl:p-5 ${className}`}>
      {children}
    </div>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-4 xl:mb-5">
      <h1 className="text-[22px] font-bold tracking-tight text-brand-deep xl:text-[24px] 2xl:text-[26px]">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
    </header>
  );
}

/** The "ruled label": a light tracked heading with a trailing hairline. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-5 mb-2 flex items-center gap-3 xl:mt-6 xl:mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted after:h-px after:flex-1 after:bg-line after:content-['']">
      {children}
    </h2>
  );
}

type Tone = "good" | "warn" | "bad" | "neutral" | "brand";

// `brand` uses text-brand-dark, not text-brand: teal on brand-soft was ~4.3:1.
const TONE: Record<Tone, string> = {
  good: "bg-good-soft text-good ring-good/25",
  warn: "bg-warn-soft text-warn ring-warn/25",
  bad: "bg-bad-soft text-bad ring-bad/25",
  brand: "bg-brand-soft text-brand-dark ring-brand/25",
  neutral: "bg-wash text-muted ring-line",
};

/** A state chip. Shape plus colour, never colour alone. */
export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${TONE[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  // A disabled button's label is exactly what the attendant needs to read to
  // know what's blocking them ("Complete — KES 250 on credit"), so disabled is
  // a solid, legible neutral rather than a faded version of the live colour.
  const disabled =
    "disabled:bg-line disabled:text-muted disabled:shadow-none disabled:opacity-100 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? `bg-brand text-white shadow-sm hover:bg-brand-dark active:bg-brand-deep ${disabled}`
      : variant === "danger"
        ? `bg-bad text-white shadow-sm hover:bg-bad-dark ${disabled}`
        : `bg-white text-brand-dark ring-1 ring-inset ring-line hover:bg-wash ${disabled}`;
  return (
    <button
      {...rest}
      className={`inline-flex min-h-12 items-center justify-center rounded-full px-5 text-sm font-bold transition-colors ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "ghost",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
}) {
  const styles =
    variant === "primary"
      ? "bg-brand text-white shadow-sm hover:bg-brand-dark active:bg-brand-deep"
      : "bg-white text-brand-dark ring-1 ring-inset ring-line hover:bg-wash";
  return (
    <Link
      href={href}
      className={`inline-flex min-h-12 items-center justify-center rounded-full px-5 text-sm font-bold transition-colors ${styles}`}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs font-medium text-muted">{hint}</span> : null}
    </label>
  );
}

/**
 * Input styling without a width, for the few places that need a narrow box
 * (a quantity column next to a label). Appending `w-24` to `inputClass` does
 * not work: both are width utilities of equal specificity, and Tailwind emits
 * `w-full` last, so it silently wins and squashes the label beside it.
 */
export const inputClassBase =
  "rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink placeholder:text-muted shadow-[inset_0_1px_2px_rgb(13_43_48/0.04)] focus:border-brand";

export const inputClass = `${inputClassBase} w-full`;

/** Wide tables must scroll inside their own box, never the page. */
export function TableWrap({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto rounded-3xl bg-white shadow-card ring-1 ring-ink/5 ${className}`}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`border-b border-line bg-wash px-3 py-2 text-[10px] xl:px-3.5 font-semibold uppercase tracking-[0.12em] text-muted ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`border-t border-line px-3 py-2 xl:px-3.5 xl:py-2.5 ${align === "right" ? "text-right tnum" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

/**
 * The phone-width answer to a multi-column table: line 1 carries the name and
 * the ONE decisive number, line 2 the muted metadata. Several screens were
 * squeezing five-column tables into 390px before this existed.
 */
export function ListRow({
  title,
  value,
  meta,
  valueTone = "plain",
  href,
}: {
  title: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  valueTone?: "good" | "bad" | "plain";
  href?: string;
}) {
  const valueClass =
    valueTone === "bad" ? "text-bad" : valueTone === "good" ? "text-good" : "text-brand-deep";
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
        <span className={`shrink-0 text-sm font-extrabold tnum ${valueClass}`}>{value}</span>
      </div>
      {meta ? <div className="mt-0.5 text-xs text-muted">{meta}</div> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="block border-t border-line px-1 py-2.5 first:border-t-0">
        {body}
      </Link>
    );
  }
  return <div className="border-t border-line px-1 py-2.5 first:border-t-0">{body}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-line bg-wash/60 py-10 text-center text-sm font-medium text-muted">
      {children}
    </p>
  );
}

export function Alert({ tone = "bad", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      className={`rounded-2xl px-4 py-3 text-sm font-semibold ring-1 ring-inset ${TONE[tone]}`}
      role="status"
    >
      {children}
    </div>
  );
}

/** A headline figure — the kind of number the owner opens the app to see. */
export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white p-3.5 pt-4 shadow-card ring-1 ring-ink/5 xl:p-4 xl:pt-5 2xl:p-5 2xl:pt-6">
      <span aria-hidden className="brand-thread absolute inset-x-0 top-0 h-[3px]" />
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="mt-1.5 text-[26px] font-extrabold leading-none tracking-tight text-brand-deep tnum xl:text-[30px]">
        {value}
      </div>
      {detail ? <div className="mt-1.5 text-xs font-medium text-muted">{detail}</div> : null}
    </div>
  );
}

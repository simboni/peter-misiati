/**
 * Shared building blocks. Every module uses these so the system looks like one
 * product rather than ten screens by ten different hands.
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
    <div className={`rounded-2xl border border-line bg-white p-4 ${className}`}>{children}</div>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-4">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
    </header>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
      {children}
    </h2>
  );
}

type Tone = "good" | "warn" | "bad" | "neutral" | "brand";

const TONE: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  brand: "bg-brand-soft text-brand",
  neutral: "bg-wash text-muted",
};

/** A state chip. Shape plus colour, never colour alone. */
export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE[tone]}`}
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
  // know what's blocking them ("Complete — KES 250 on credit"). opacity-50 made
  // that 1.47:1 — an invisible slab in sunlight. Disabled is now a solid, legible
  // neutral instead of a faded version of the live colour.
  const disabled =
    "disabled:bg-line disabled:text-muted disabled:border-line disabled:opacity-100 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? `bg-brand text-white hover:bg-brand-dark ${disabled}`
      : variant === "danger"
        ? `bg-bad text-white hover:opacity-90 ${disabled}`
        : `border border-line bg-white text-ink hover:bg-wash ${disabled}`;
  return (
    <button
      {...rest}
      className={`rounded-xl px-4 py-3 text-sm font-bold transition-colors ${styles} ${className}`}
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
      ? "bg-brand text-white hover:bg-brand-dark"
      : "border border-line bg-white text-ink hover:bg-wash";
  return (
    <Link
      href={href}
      className={`inline-block rounded-xl px-4 py-3 text-sm font-bold transition-colors ${styles}`}
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
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
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
  "rounded-xl border border-line bg-white px-3 py-3 text-base text-ink placeholder:text-muted";

export const inputClass = `${inputClassBase} w-full`;

/** Wide tables must scroll inside their own box, never the page. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white">
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
      className={`border-b border-line px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted ${
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
      className={`border-t border-line px-3 py-2 ${align === "right" ? "text-right tnum" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}

export function Alert({ tone = "bad", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`rounded-xl px-3.5 py-2.5 text-sm font-medium ${TONE[tone]}`} role="status">
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
    <div className="rounded-2xl border border-line bg-white p-3.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-1 text-xl font-extrabold tracking-tight tnum">{value}</div>
      {detail ? <div className="mt-0.5 text-xs text-muted">{detail}</div> : null}
    </div>
  );
}

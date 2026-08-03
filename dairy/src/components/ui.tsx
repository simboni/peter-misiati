/**
 * Shared UI primitives.
 *
 * Rules these encode, from docs/dairy/03-modules.md:
 *   R8  Max two levels of navigation. Home is a flat grid of task tiles.
 *   R9  Every screen works with the text ignored — icon, colour and position
 *       carry the meaning.
 *   R6  Every save returns a persistent, re-viewable receipt.
 */
import type { ReactNode } from "react";

/* ---------------------------------------------------------------- */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-4 ${className}`}>{children}</div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{children}</h1>
      {sub ? <p className="mt-1 text-sm text-ink-2">{sub}</p> : null}
    </header>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "quiet";
}) {
  const styles = {
    primary: "bg-brand text-white hover:opacity-90",
    secondary: "bg-surface text-ink border border-line hover:bg-paper",
    danger: "bg-danger text-white hover:opacity-90",
    quiet: "bg-transparent text-ink-2 hover:text-ink",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-5 py-3 text-base font-semibold disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A form field. The label is always visible — placeholder-as-label fails the
 * moment someone starts typing, and it fails hardest for the users who need the
 * label most.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-ink-3">{hint}</span> : null}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-line bg-surface px-3 py-2 text-base ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-md border border-line bg-surface px-3 py-2 text-base ${props.className ?? ""}`}
    />
  );
}

/* ---------------------------------------------------------------- */

/**
 * The confirmation card, modelled on the M-Pesa receipt — which is how Kenyan
 * customers *learned to trust* mobile money. Persistent and re-viewable, never
 * a toast that vanishes before the herdsman has looked up.
 */
export function Receipt({
  title,
  lines,
  refCode,
  tone = "ok",
  children,
}: {
  title: string;
  lines: string[];
  refCode?: string;
  tone?: "ok" | "warn" | "danger";
  children?: ReactNode;
}) {
  const border = { ok: "border-brand", warn: "border-brass", danger: "border-danger" }[tone];
  const mark = { ok: "✓", warn: "!", danger: "⛔" }[tone];
  return (
    <div className={`rounded-lg border-l-4 ${border} border-y border-r border-line bg-surface p-4`}>
      <p className="font-semibold">
        <span aria-hidden className="mr-2">{mark}</span>
        {title}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-ink-2">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {refCode ? (
        <p className="mt-3 font-mono text-xs tracking-wider text-ink-3">Ref {refCode}</p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * A soft warning that saves anyway.
 *
 * Rigid required fields do not produce complete data, they produce invented
 * data — one study attributed 80% of errors to required fields plus free text.
 * So out-of-range values warn here and are stored flagged for the manager.
 */
export function SoftWarning({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border-l-4 border-brass bg-brass-soft px-3 py-2 text-sm" role="status">
      <span aria-hidden className="mr-2">⚠</span>
      {message}
      {children}
    </div>
  );
}

/** The one hard stop in the system. Used only for withdrawal periods. */
export function HardBlock({ message }: { message: string }) {
  return (
    <div
      className="rounded-md border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm font-medium"
      role="alert"
    >
      <span aria-hidden className="mr-2">⛔</span>
      {message}
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "brand";
}) {
  const styles = {
    neutral: "border-line text-ink-2",
    ok: "border-ok text-ok",
    warn: "border-brass text-brass",
    danger: "border-danger text-danger",
    brand: "border-brand bg-brand text-white",
  }[tone];
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line p-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink-3">{hint}</p> : null}
    </div>
  );
}

/**
 * Home is a flat grid of these. No hamburger menu, no nested tabs — the
 * low-literacy HCI literature is unambiguous that hierarchy is where these
 * users get lost, and every tile carries a figurative icon, a word and a
 * position so the screen reads without the text.
 */
export function TaskTile({
  href,
  icon,
  label,
  detail,
}: {
  href: string;
  icon: string;
  label: string;
  detail?: string;
}) {
  return (
    <a
      href={href}
      className="tap flex flex-col items-start gap-1 rounded-lg border border-line bg-surface p-5 hover:border-brand"
    >
      <span aria-hidden className="text-3xl leading-none">
        {icon}
      </span>
      <span className="mt-2 text-lg font-semibold">{label}</span>
      {detail ? <span className="text-sm text-ink-3">{detail}</span> : null}
    </a>
  );
}

/** Money and litres line up in columns, so digits must be tabular. */
export function Num({ children }: { children: ReactNode }) {
  return <span className="tabular-nums">{children}</span>;
}

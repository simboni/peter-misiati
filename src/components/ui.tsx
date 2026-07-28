import Link from "next/link";

/* Shared UI primitives — buttons, section labels, chips. */

type ButtonVariant = "primary" | "donate" | "ghost";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-green-400 text-on-accent hover:bg-green-500 shadow-[0_10px_24px_-12px_var(--color-green-500)]",
  donate:
    "bg-accent-400 text-on-red hover:bg-accent-500 shadow-[0_10px_24px_-12px_var(--color-accent-500)]",
  ghost:
    "border border-ink-500 text-mist-200 hover:border-green-400 hover:text-mist-100 bg-transparent",
};

export function Button({
  href,
  variant = "primary",
  className = "",
  children,
  external = false,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-colors duration-200 ${buttonStyles[variant]} ${className}`;
  if (external || href.startsWith("mailto:") || href.startsWith("http")) {
    return (
      <a href={href} className={cls} {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`kicker mb-3 flex items-center gap-2.5 ${className}`}>
      <span className="inline-block h-px w-8 bg-green-400" aria-hidden />
      {children}
    </p>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "red";
}) {
  const tones = {
    neutral: "border-ink-600 bg-ink-850 text-mist-400",
    green: "border-green-400/30 bg-green-400/10 text-green-300",
    red: "border-accent-400/30 bg-accent-400/10 text-accent-300",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  center = false,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <Eyebrow className={center ? "justify-center" : ""}>{eyebrow}</Eyebrow>
      <h2 className="font-display text-3xl font-bold tracking-tight text-mist-100 sm:text-4xl text-balance">
        {title}
      </h2>
      {lede ? <p className="mt-4 text-base leading-relaxed text-mist-400">{lede}</p> : null}
    </div>
  );
}

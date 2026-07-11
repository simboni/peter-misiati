import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ArrowRightIcon } from "@/components/icons";

/* ------------------------------- Button ------------------------------- */

type ButtonVariant = "primary" | "gold" | "outline" | "ghost" | "white";
type ButtonSize = "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-400 focus-visible:ring-offset-2 focus-visible:ring-offset-cream-50 disabled:opacity-60 disabled:pointer-events-none";

const buttonVariants: Record<ButtonVariant, string> = {
  // primary terracotta CTA
  primary:
    "bg-terra-600 text-cream-50 hover:bg-terra-700 shadow-[0_10px_28px_-12px_rgba(109,58,21,0.7)]",
  // gold accent CTA
  gold: "bg-gold-400 text-terra-900 font-semibold hover:bg-gold-300 shadow-[0_10px_28px_-12px_rgba(192,138,46,0.75)]",
  // outline on cream
  outline:
    "border border-line-strong text-ink-800 hover:border-terra-400 hover:text-terra-600 hover:bg-terra-50",
  ghost: "text-terra-600 hover:text-terra-700",
  // for dark / photo backgrounds
  white: "bg-cream-50 text-terra-800 hover:bg-white shadow-sm",
};

const buttonSizes: Record<ButtonSize, string> = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href?: string;
  withArrow?: boolean;
  className?: string;
  children: ReactNode;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
} & Omit<ComponentPropsWithoutRef<"a">, "href" | "onClick">;

export function Button({
  variant = "primary",
  size = "md",
  href,
  withArrow = false,
  className = "",
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const cls = `${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`;
  const content = (
    <>
      {children}
      {withArrow && (
        <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
      )}
    </>
  );
  if (href) {
    const external =
      href.startsWith("http") || href.startsWith("tel:") || href.startsWith("mailto:");
    if (external) {
      return (
        <a href={href} className={`group/btn ${cls}`} onClick={onClick} {...rest}>
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={`group/btn ${cls}`} onClick={onClick}>
        {content}
      </Link>
    );
  }
  return (
    <button
      className={`group/btn ${cls}`}
      onClick={onClick}
      {...(rest as ComponentPropsWithoutRef<"button">)}
    >
      {content}
    </button>
  );
}

/* ------------------------------ Section ------------------------------- */

export function Section({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`py-16 sm:py-20 lg:py-24 ${className}`}>
      <div className="container-page">{children}</div>
    </section>
  );
}

/* --------------------------- Eyebrow / kicker ------------------------- */

export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`kicker inline-flex items-center gap-2 ${className}`}>
      <span className="h-px w-6 bg-gold-400" aria-hidden="true" />
      {children}
    </span>
  );
}

/* --------------------------- Section heading -------------------------- */

export function SectionHeading({
  eyebrow,
  title,
  intro,
  align = "left",
  className = "",
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  const alignCls = align === "center" ? "items-center text-center mx-auto" : "items-start";
  return (
    <div className={`flex max-w-2xl flex-col gap-4 ${alignCls} ${className}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="font-display text-3xl font-semibold leading-[1.1] tracking-tight text-ink-900 sm:text-4xl lg:text-[2.7rem]">
        {title}
      </h2>
      {intro && (
        <p className="text-base leading-relaxed text-ink-600 sm:text-lg">{intro}</p>
      )}
    </div>
  );
}

/* ------------------------------- Rubric ------------------------------- */
/* Decorative divider with a diamond — a gentle liturgical rubric mark.  */

export function Rubric({ className = "" }: { className?: string }) {
  return (
    <div className={`rubric ${className}`} aria-hidden="true">
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 shrink-0 rotate-45 fill-gold-400">
        <rect x="1" y="1" width="10" height="10" rx="1.5" />
      </svg>
    </div>
  );
}

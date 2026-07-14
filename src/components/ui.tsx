import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ArrowRightIcon } from "@/components/icons";

/* ------------------------------- Button ------------------------------- */
/* Variant names are kept stable across the app; the palette is emerald/ink. */

type ButtonVariant = "primary" | "gold" | "outline" | "ghost" | "white";
type ButtonSize = "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 disabled:opacity-60 disabled:pointer-events-none";

const buttonVariants: Record<ButtonVariant, string> = {
  // primary emerald CTA
  gold: "bg-green-400 text-ink-950 font-semibold hover:bg-green-300",
  // solid dark
  primary: "bg-ink-700 text-mist-100 border border-ink-600 hover:border-green-500 hover:text-green-300",
  // outline
  outline:
    "border border-ink-600 text-mist-200 hover:border-green-400 hover:text-green-300 hover:bg-green-400/5",
  ghost: "text-mist-300 hover:text-green-300",
  // light-ish secondary on dark
  white: "border border-ink-500 text-mist-100 hover:border-green-400 hover:text-green-300",
};

const buttonSizes: Record<ButtonSize, string> = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
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

/* --------------------------- Kicker / Eyebrow ------------------------- */
/* A code-comment style label: // selected work */

export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
  /** kept for API compatibility; the design is single-theme */
  light?: boolean;
}) {
  return (
    <span className={`kicker inline-flex items-center gap-1.5 ${className}`}>
      <span className="text-mist-600">{"//"}</span>
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
  light?: boolean;
  className?: string;
}) {
  const alignCls = align === "center" ? "items-center text-center mx-auto" : "items-start";
  return (
    <div className={`flex max-w-2xl flex-col gap-4 ${alignCls} ${className}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-mist-100 text-balance sm:text-4xl">
        {title}
      </h2>
      {intro && (
        <p className="text-base leading-relaxed text-mist-400 sm:text-lg">{intro}</p>
      )}
    </div>
  );
}

import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ArrowRightIcon } from "@/components/icons";

/* ------------------------------- Button ------------------------------- */

type ButtonVariant = "primary" | "leaf" | "outline" | "ghost" | "white";
type ButtonSize = "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-400 focus-visible:ring-offset-2";

const buttonVariants: Record<ButtonVariant, string> = {
  // primary forest-green CTA
  primary:
    "bg-forest-600 text-white hover:bg-forest-700 shadow-[0_10px_24px_-10px_rgba(29,107,57,0.7)]",
  // vivid leaf CTA (donate)
  leaf: "bg-leaf-500 text-forest-900 hover:bg-leaf-400 shadow-[0_10px_24px_-10px_rgba(119,205,56,0.75)]",
  // outline on light
  outline:
    "border border-forest-200 text-forest-700 hover:border-forest-400 hover:bg-forest-50",
  ghost: "text-forest-700 hover:text-forest-800 hover:bg-forest-50",
  // for dark / photo backgrounds
  white: "bg-white text-forest-800 hover:bg-sand-50 shadow-lift",
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
    <section id={id} className={`py-16 sm:py-20 lg:py-28 ${className}`}>
      <div className="container-page">{children}</div>
    </section>
  );
}

/* --------------------------- Kicker / Eyebrow ------------------------- */

export function Eyebrow({
  children,
  center = false,
  className = "",
}: {
  children: ReactNode;
  center?: boolean;
  className?: string;
}) {
  return (
    <span className={`kicker ${center ? "kicker-center" : ""} ${className}`}>
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
  const alignCls =
    align === "center" ? "items-center text-center mx-auto" : "items-start";
  return (
    <div className={`flex max-w-2xl flex-col gap-4 ${alignCls} ${className}`}>
      {eyebrow && <Eyebrow center={align === "center"}>{eyebrow}</Eyebrow>}
      <h2 className="font-display text-3xl font-bold leading-[1.12] tracking-tight text-ink-900 text-balance sm:text-4xl lg:text-[2.6rem]">
        {title}
      </h2>
      {intro && (
        <p className="text-base leading-relaxed text-ink-500 text-pretty sm:text-lg">
          {intro}
        </p>
      )}
    </div>
  );
}

/* ------------------------------- Pill --------------------------------- */

export function Pill({
  children,
  tone = "forest",
  className = "",
}: {
  children: ReactNode;
  tone?: "forest" | "leaf" | "sand" | "white";
  className?: string;
}) {
  const tones = {
    forest: "bg-forest-50 text-forest-700 ring-1 ring-forest-100",
    leaf: "bg-leaf-500/15 text-leaf-600 ring-1 ring-leaf-500/25",
    sand: "bg-sand-100 text-soil-700 ring-1 ring-sand-200",
    white: "bg-white/15 text-white ring-1 ring-white/25 backdrop-blur",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

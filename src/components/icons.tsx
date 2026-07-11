import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

/* ------------------------------ UI icons ------------------------------ */

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

export function HeartHandIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M11 14 7.5 10.5a2.1 2.1 0 0 1 3-3l.5.5.5-.5a2.1 2.1 0 0 1 3 3L11 14Z" />
      <path d="M3 14v5a1 1 0 0 0 1 1h3l3.6 1.6a3 3 0 0 0 2.3.1l6-2.2a1.5 1.5 0 0 0-1-2.8l-4 1.3" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/* ------------------------------ Ministry icons ------------------------------ */

export function BookIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 6.5C10.5 5 8 4.5 4 4.7v13c4-.2 6.5.3 8 1.8 1.5-1.5 4-2 8-1.8v-13c-4-.2-6.5.3-8 1.8Z" />
      <path d="M12 6.5V19" />
    </svg>
  );
}

export function FlameIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3c.6 3-1.5 4.2-2.7 5.6C8 10 7 11.4 7 13.5A5 5 0 0 0 17 13.5c0-2-1-3.2-1.8-4.5C14.2 7.4 13.5 6 14 4c-.8.6-1.6 1.4-2 2.4C11.3 5.2 11.6 4 12 3Z" />
    </svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 20s-7-4.4-9.3-9A5 5 0 0 1 12 6.5 5 5 0 0 1 21.3 11C19 15.6 12 20 12 20Z" />
    </svg>
  );
}

export function HandsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v6" />
      <path d="M8 10V6.5a1.5 1.5 0 0 1 3 0V10M16 10V6.5a1.5 1.5 0 0 0-3 0V10" />
      <path d="M6 10.5v3a6 6 0 0 0 12 0v-3M4 12l2 1.5M20 12l-2 1.5M9 20h6" />
    </svg>
  );
}

export function DoveIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 7c2.5.5 4 2 5 4 1.3 2.6 3.5 4.5 7 4.5 3 0 5-1.8 5-4.5 0-2-1.3-3.5-3-4l1-3-3 2c-1-.7-2.2-1-3.5-1" />
      <path d="M9 15c-1 2-3 3-6 3 1.5-1.5 2-3 2-5" />
      <circle cx="16.5" cy="8.2" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ministryIcons = {
  book: BookIcon,
  flame: FlameIcon,
  heart: HeartIcon,
  hands: HandsIcon,
  dove: DoveIcon,
} as const;

export function MinistryIcon({
  name,
  ...props
}: { name: keyof typeof ministryIcons } & IconProps) {
  const Cmp = ministryIcons[name];
  return <Cmp {...props} />;
}

/* ------------------------------ Social icons ------------------------------ */

export function FacebookIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
    </svg>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function YouTubeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M23 12s0-3.2-.4-4.7a2.5 2.5 0 0 0-1.8-1.8C19.2 5 12 5 12 5s-7.2 0-8.8.5A2.5 2.5 0 0 0 1.4 7.3C1 8.8 1 12 1 12s0 3.2.4 4.7a2.5 2.5 0 0 0 1.8 1.8C4.8 19 12 19 12 19s7.2 0 8.8-.5a2.5 2.5 0 0 0 1.8-1.8C23 15.2 23 12 23 12Zm-13 3V9l5.2 3-5.2 3Z" />
    </svg>
  );
}

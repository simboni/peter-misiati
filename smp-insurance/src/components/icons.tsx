/**
 * Inline SVG icon set — stroke-based, inherits currentColor.
 * Product icons are looked up by key via <ProductIcon name="..." />.
 */

type IconProps = { className?: string };

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function CarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11" />
      <path d="M4 11h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1M4 11a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1" />
      <circle cx="7.5" cy="16.5" r="1.8" />
      <circle cx="16.5" cy="16.5" r="1.8" />
      <path d="M9.3 16.5h5.4" />
    </svg>
  );
}

export function HealthIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M12 21s-7.5-4.6-9.3-9.5C1.5 8 3.6 4.8 6.9 4.8c2 0 3.6 1.1 4.4 2.7h1.4c.8-1.6 2.4-2.7 4.4-2.7 3.3 0 5.4 3.2 4.2 6.7C19.5 16.4 12 21 12 21z" />
      <path d="M12 9.5v5M9.5 12h5" />
    </svg>
  );
}

export function UmbrellaIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z" />
      <path d="M12 3v-.5M12 12v6.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M12 3l7.5 3v5.2c0 4.6-3.1 8-7.5 9.8-4.4-1.8-7.5-5.2-7.5-9.8V6z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M3.5 10.5L12 3.5l8.5 7" />
      <path d="M5.5 9v10.5h13V9" />
      <path d="M10 19.5v-5h4v5" />
    </svg>
  );
}

export function BriefcaseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <rect x="3" y="7.5" width="18" height="12" rx="2" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.5h18" />
      <path d="M12 11.5v2" />
    </svg>
  );
}

export function HardHatIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M4 16a8 8 0 0 1 16 0" />
      <path d="M10 8.5V6.8A1.8 1.8 0 0 1 11.8 5h.4A1.8 1.8 0 0 1 14 6.8v1.7" />
      <path d="M2.5 16.5c0-1 .8-1.5 1.8-1.5h15.4c1 0 1.8.5 1.8 1.5s-.8 1.5-1.8 1.5H4.3c-1 0-1.8-.5-1.8-1.5z" />
    </svg>
  );
}

export function PlaneIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M10.5 13.5L4 11l1.5-1.5 6 .5 4.5-4.5a1.6 1.6 0 0 1 2.3 2.3L13.8 12l.5 6L12.8 19.5l-2.3-6z" />
      <path d="M5 19h6" />
    </svg>
  );
}

export function LeafIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M4 20c0-9 5-14 16-16-1 11-6 15-13 15" />
      <path d="M4 20c3-6 7-9 12-11" />
    </svg>
  );
}

export function PiggyIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M5.5 11.5C5.5 8 8.5 5.5 12.5 5.5S19.5 8 19.5 11.5c0 1.6-.7 3-1.8 4.1l.3 2.9h-2.5l-.5-1.2a8.8 8.8 0 0 1-5 0l-.5 1.2H7l.3-2.9a6.6 6.6 0 0 1-1.8-3.1" />
      <path d="M5.5 11.5c-1.2 0-2-.6-2-1.8M15 10.2h.01" />
      <path d="M10.5 5.9a3.5 3.5 0 0 1 4 0" />
    </svg>
  );
}

export function GroupIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="16.5" cy="9.5" r="2.4" />
      <path d="M16.5 14.5c2.3 0 4 1.6 4 4" />
    </svg>
  );
}

export function PhoneIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M5 4h4l1.5 4.5L8 10a12 12 0 0 0 6 6l1.5-2.5L20 15v4a1.9 1.9 0 0 1-2 2C9.7 20.5 3.5 14.3 3 6a1.9 1.9 0 0 1 2-2z" />
    </svg>
  );
}

export function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12.04 2a9.9 9.9 0 0 0-8.5 15L2 22l5.15-1.5A9.9 9.9 0 1 0 12.04 2zm0 1.8a8.1 8.1 0 1 1-4.1 15.1l-.3-.17-3.05.9.92-2.97-.2-.31A8.1 8.1 0 0 1 12.04 3.8zm-3.3 4.1c-.2 0-.5.07-.76.36-.26.29-1 .97-1 2.36 0 1.4 1.02 2.75 1.16 2.94.14.19 1.97 3.16 4.86 4.3 2.4.95 2.9.76 3.42.71.52-.05 1.68-.68 1.92-1.35.24-.66.24-1.23.17-1.35-.07-.12-.26-.19-.55-.33-.29-.14-1.68-.83-1.94-.92-.26-.1-.45-.15-.64.14-.19.28-.74.92-.9 1.11-.17.19-.34.21-.63.07a7.9 7.9 0 0 1-2.3-1.42 8.6 8.6 0 0 1-1.58-1.98c-.17-.28-.02-.44.12-.58.13-.13.29-.33.43-.5.14-.17.19-.28.29-.47.1-.19.05-.36-.02-.5-.07-.14-.63-1.55-.89-2.12-.23-.5-.47-.5-.65-.5z" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} strokeWidth={2.2} aria-hidden>
      <path d="M4.5 12.5l5 5L19.5 7" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} strokeWidth={2.2} aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} strokeWidth={2} aria-hidden>
      <path d="M4 12h15M13 5.5L19.5 12 13 18.5" />
    </svg>
  );
}

export function MapPinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M12 21s-6.5-5.6-6.5-10.4a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.4" r="2.3" />
    </svg>
  );
}

export function MailIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6l-5.3 2.8 1-5.9-4.2-4.1 5.9-.8z" />
    </svg>
  );
}

export function DocumentIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden>
      <path d="M6 3.5h8L19 8.5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" />
      <path d="M14 3.5v5h5M9 12.5h6M9 16h6" />
    </svg>
  );
}

const productIcons = {
  car: CarIcon,
  health: HealthIcon,
  umbrella: UmbrellaIcon,
  shield: ShieldIcon,
  home: HomeIcon,
  briefcase: BriefcaseIcon,
  hardhat: HardHatIcon,
  plane: PlaneIcon,
  leaf: LeafIcon,
  piggy: PiggyIcon,
  group: GroupIcon,
} as const;

export type ProductIconName = keyof typeof productIcons;

export function ProductIcon({
  name,
  className,
}: {
  name: ProductIconName;
  className?: string;
}) {
  const Icon = productIcons[name];
  return <Icon className={className} />;
}

type IconProps = React.SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...props,
  };
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12h16m0 0-6-6m6 6-6 6" />
    </svg>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 17 17 7m0 0H8m9 0v9" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 20.5s-7.5-4.6-9.3-9.6C1.5 7.6 3.6 4.5 6.9 4.5c2 0 3.6 1.1 4.6 2.7l.5.8.5-.8c1-1.6 2.6-2.7 4.6-2.7 3.3 0 5.4 3.1 4.2 6.4-1.8 5-9.3 9.6-9.3 9.6Z" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2m0 14.6v2.2M2.5 12h2.2m14.6 0h2.2M5.3 5.3l1.6 1.6m10.2 10.2 1.6 1.6m0-13.4-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
    </svg>
  );
}

/* ---- program icons -------------------------------------------------- */

export function BookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 6.5C10.5 5 8.4 4.5 5.5 4.5c-.9 0-1.7.1-2.5.3v13.4c.8-.2 1.6-.3 2.5-.3 2.9 0 5 .6 6.5 2 1.5-1.4 3.6-2 6.5-2 .9 0 1.7.1 2.5.3V4.8c-.8-.2-1.6-.3-2.5-.3-2.9 0-5 .5-6.5 2Z" />
      <path d="M12 6.5v13.4" />
    </svg>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 21h8m-4-4v4m-5-17h10v6a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4.5A1.5 1.5 0 0 0 3 7.5C3 9.4 4.6 11 6.5 11H7m10-5h2.5A1.5 1.5 0 0 1 21 7.5C21 9.4 19.4 11 17.5 11H17" />
    </svg>
  );
}

export function ChipIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3" />
    </svg>
  );
}

export function CoinsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  );
}

export function HandsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21c-4.5-2.6-8-6-8-10V6l8-3 8 3v5c0 4-3.5 7.4-8 10Z" />
      <path d="m8.5 11.5 2.5 2.5 4.5-4.5" />
    </svg>
  );
}

/* ---- value icons ---------------------------------------------------- */

export function FlagIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 21V4m0 1.5c1.4-1 2.9-1.5 4.5-1.3 2 .2 3.4 1.5 5.4 1.6 1.4.1 2.8-.3 4.1-1.1v8.6c-1.3.8-2.7 1.2-4.1 1.1-2-.1-3.4-1.4-5.4-1.6-1.6-.2-3.1.3-4.5 1.3" />
    </svg>
  );
}

export function HandshakeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m11 17.5 2.2 2.1a1.7 1.7 0 0 0 2.4-2.4l.3.3a1.7 1.7 0 1 0 2.4-2.4L14 10.8" />
      <path d="M21 12.6 22.5 8 18 6l-3.4 1.5a2 2 0 0 0-1 .9L12.5 10a1.6 1.6 0 0 0 2.7 1.7l1.2-1.5M3 13.5 1.5 8.5 6 6l3.5 1.2m-4 8.8-.8-.9M12 19.9l-1.4 1a1.6 1.6 0 0 1-2.1-.3l-2.9-3.3" />
    </svg>
  );
}

export function CompassIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </svg>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v18m-4 0h8M4 7h16M6.5 7l-2.8 6a3 3 0 0 0 5.6 0L6.5 7Zm11 0-2.8 6a3 3 0 0 0 5.6 0l-2.8-6Z" />
    </svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.4 3.8 5.6 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3Z" />
    </svg>
  );
}

/* ---- misc ----------------------------------------------------------- */

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6m2 8.7c-.3-1.9-1.2-3.4-2.4-4.3" />
    </svg>
  );
}

export function TargetIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function LeafIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 19c0-8 4-13 14-14 .5 10-4 14-11 14-1 0-2-.2-3-.5Z" />
      <path d="M5 19c2-4.5 5.5-8 10-10.5" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M8 3v4m8-4v4M3.5 10.5h17" />
    </svg>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.8 3.5c.6 0 1.1.4 1.3 1l.9 2.6a1.4 1.4 0 0 1-.4 1.5L7.2 10a13.6 13.6 0 0 0 6.8 6.8l1.4-1.4a1.4 1.4 0 0 1 1.5-.4l2.6.9c.6.2 1 .7 1 1.3v2.4c0 .8-.7 1.5-1.5 1.4C10.6 20.6 3.4 13.4 3 5c0-.8.6-1.5 1.4-1.5h2.4Z" />
    </svg>
  );
}

export function FacebookIcon(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <path d="M13.6 21v-7.3h2.45l.37-2.85H13.6V9.03c0-.82.23-1.39 1.41-1.39h1.5V5.09c-.26-.03-1.15-.11-2.19-.11-2.17 0-3.66 1.32-3.66 3.76v2.1H8.2v2.85h2.46V21h2.94Z" />
    </svg>
  );
}

export function LinkedInIcon(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <path d="M6.94 8.5a1.44 1.44 0 1 0 0-2.88 1.44 1.44 0 0 0 0 2.88ZM5.7 10.2h2.48V18H5.7v-7.8Zm4.3 0h2.38v1.07h.03c.33-.63 1.14-1.29 2.35-1.29 2.51 0 2.97 1.65 2.97 3.8V18h-2.48v-3.74c0-.89-.02-2.04-1.24-2.04-1.24 0-1.43.97-1.43 1.97V18H10V10.2Z" />
    </svg>
  );
}

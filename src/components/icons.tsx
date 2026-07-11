import type { SVGProps } from "react";

// Shared props: consistent 1.6 stroke, rounded, currentColor.
type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ---- Service / industry icons (keyed by the `icon` field in firm.ts) ---- */

export const iconMap = {
  shield: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
      <path d="m9 12 2 2 4-4" />
    </Base>
  ),
  document: (p: IconProps) => (
    <Base {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </Base>
  ),
  scale: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 4v16M7 20h10M5 8h14M8 4l-3 8a3 3 0 0 0 6 0L8 4zM16 4l-3 8a3 3 0 0 0 6 0l-3-8z" />
    </Base>
  ),
  receipt: (p: IconProps) => (
    <Base {...p}>
      <path d="M6 3h12v18l-2-1.2L14 21l-2-1.2L10 21l-2-1.2L6 21z" />
      <path d="M9 8h6M9 12h6" />
    </Base>
  ),
  search: (p: IconProps) => (
    <Base {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Base>
  ),
  book: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z" />
    </Base>
  ),
  chart: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 4v16h16" />
      <path d="M8 15v-3M12 15V9M16 15v-6" />
    </Base>
  ),
  users: (p: IconProps) => (
    <Base {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 20a5.5 5.5 0 0 0-3-4.9" />
    </Base>
  ),
  id: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6.5 16a2.8 2.8 0 0 1 5 0M14 10h4M14 13h4" />
    </Base>
  ),
  lightbulb: (p: IconProps) => (
    <Base {...p}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.5.7.5 1.1v0h6v0c0-.4 0-.7.5-1.1A6 6 0 0 0 12 3z" />
    </Base>
  ),
  building: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
      <path d="M14 9h4a2 2 0 0 1 2 2v10M4 21h18" />
      <path d="M7 7h3M7 11h3M7 15h3M17 13h1M17 17h1" />
    </Base>
  ),
  clipboard: (p: IconProps) => (
    <Base {...p}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9z" />
      <path d="M9 11h6M9 15h4" />
    </Base>
  ),
  cap: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 5 2 9l10 4 10-4-10-4z" />
      <path d="M6 11v4c0 1.1 2.7 2.5 6 2.5s6-1.4 6-2.5v-4M21 9.5v4.5" />
    </Base>
  ),
  hands: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 21s-7-4-9-8.5C1.5 9 3.5 6 6.5 6c1.8 0 3 1 5.5 3.5C14.5 7 15.7 6 17.5 6c3 0 5 3 3.5 6.5C19 17 12 21 12 21z" />
    </Base>
  ),
  briefcase: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M11 12h2" />
    </Base>
  ),
  code: (p: IconProps) => (
    <Base {...p}>
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
    </Base>
  ),
  layout: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11" />
    </Base>
  ),
  server: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Base>
  ),
  database: (p: IconProps) => (
    <Base {...p}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </Base>
  ),
  cloud: (p: IconProps) => (
    <Base {...p}>
      <path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9.5 3.5 3.5 0 0 1 17.5 18z" />
    </Base>
  ),
  tools: (p: IconProps) => (
    <Base {...p}>
      <path d="M14.5 5.5a3.5 3.5 0 0 0 4.6 4.6L21 12l-4 4-2-2-6.5 6.5a2.1 2.1 0 0 1-3-3L12 11 10 9l1.9-1.9a3.5 3.5 0 0 1 2.6-1.6z" />
    </Base>
  ),
  rocket: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 15c-1.5 1-2 4-2 4s3-.5 4-2M9 15l-3-3c1-5 5-9 11-9 0 6-4 10-9 11zM14 8a1.5 1.5 0 1 0 2 0 1.5 1.5 0 0 0-2 0z" />
    </Base>
  ),
  sparkle: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </Base>
  ),
} as const;

export type IconName = keyof typeof iconMap;

export function ServiceIcon({
  name,
  ...props
}: { name: string } & IconProps) {
  const Cmp = iconMap[name as IconName] ?? iconMap.document;
  return <Cmp {...props} />;
}

/* --------------------------- Utility icons --------------------------- */

export const PhoneIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 5c0-1 .8-2 2-2h1.5c.5 0 .9.3 1 .8l.8 3c.1.5 0 .9-.4 1.2L8 9.5a12 12 0 0 0 5.5 5.5l1.5-1.9c.3-.4.7-.5 1.2-.4l3 .8c.5.1.8.5.8 1V16c0 1.2-1 2-2 2A15 15 0 0 1 4 5z" />
  </Base>
);

export const MailIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </Base>
);

export const PinIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 21c4-4.5 7-7.6 7-11a7 7 0 1 0-14 0c0 3.4 3 6.5 7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </Base>
);

export const ClockIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Base>
);

export const WhatsAppIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 1.67c2.2 0 4.27.86 5.82 2.42a8.19 8.19 0 0 1 2.42 5.82c0 4.54-3.7 8.24-8.25 8.24a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24zm-3.2 4.44c-.15 0-.4.06-.6.29-.21.23-.8.78-.8 1.91 0 1.13.82 2.22.94 2.37.11.15 1.6 2.55 3.96 3.47 1.96.77 2.36.62 2.79.58.42-.04 1.37-.56 1.56-1.1.19-.54.19-1 .13-1.1-.06-.09-.21-.15-.44-.27-.23-.11-1.37-.68-1.58-.75-.21-.08-.36-.11-.52.11-.15.23-.59.75-.72.9-.13.15-.27.17-.5.06-.23-.12-.97-.36-1.85-1.14-.68-.61-1.14-1.36-1.28-1.59-.13-.23-.01-.35.1-.47.1-.1.23-.27.34-.4.11-.14.15-.23.23-.39.08-.15.04-.29-.02-.4-.06-.12-.52-1.26-.72-1.72-.19-.45-.38-.39-.52-.4-.13-.01-.29-.01-.44-.01z" />
  </svg>
);

export const MenuIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Base>
);

export const CloseIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);

export const CheckIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m5 12 4.5 4.5L19 7" />
  </Base>
);

export const QuoteIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M9.5 6C6.5 7.2 5 9.6 5 13.2V18h5v-5H7.6c.1-1.9.9-3.2 2.6-4L9.5 6zm9 0C15.5 7.2 14 9.6 14 13.2V18h5v-5h-2.4c.1-1.9.9-3.2 2.6-4L18.5 6z" />
  </svg>
);

export const StarIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.8l-5.8 3.05 1.1-6.46-4.7-4.58 6.5-.94L12 2.5z" />
  </svg>
);

/* --------------------------- Dev / social icons --------------------------- */

export const GitHubIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
  </svg>
);

export const LinkedInIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
  </svg>
);

export const XIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M18.24 2h3.31l-7.23 8.26L22.79 22h-6.65l-5.2-6.8L4.98 22H1.66l7.73-8.83L1.21 2h6.82l4.7 6.22L18.24 2zm-1.16 18h1.83L7.01 3.9H5.05L17.08 20z" />
  </svg>
);

export const FacebookIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.44 2.9h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z" />
  </svg>
);

export const YouTubeIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M23.5 6.5a3 3 0 0 0-2.12-2.12C19.5 3.86 12 3.86 12 3.86s-7.5 0-9.38.52A3 3 0 0 0 .5 6.5C0 8.4 0 12 0 12s0 3.6.5 5.5a3 3 0 0 0 2.12 2.12C4.5 20.14 12 20.14 12 20.14s7.5 0 9.38-.52A3 3 0 0 0 23.5 17.5C24 15.6 24 12 24 12s0-3.6-.5-5.5zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z" />
  </svg>
);

export const InstagramIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17.5 6.5h.01" />
  </svg>
);

export const LeafIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 20c0-8 6-14 16-14 0 10-6 15-14 14" />
    <path d="M4 20c4-6 8-8 12-9" />
  </Base>
);

export const SproutIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 21v-8" />
    <path d="M12 13c0-3-2-5-6-5 0 4 2 6 6 5z" />
    <path d="M12 11c0-3 2-5 6-5 0 4-2 6-6 5z" />
  </Base>
);

export const TreeIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 21v-5" />
    <path d="M12 16a6 6 0 0 0 4-10.5A5 5 0 0 0 7.5 6 6 6 0 0 0 12 16z" />
  </Base>
);

export const HeartIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 20s-7-4.4-9.3-8.3C1.2 9 2.5 5.5 6 5.5c2 0 3.2 1.2 4 2.4.8-1.2 2-2.4 4-2.4 3.5 0 4.8 3.5 3.3 6.2C19 15.6 12 20 12 20z" />
  </Base>
);

export const HandshakeIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m11 13 2 2 3-3" />
    <path d="M3 8l4-2 5 3 5-3 4 2v6l-4 4-3-2" />
    <path d="M3 8v6l4 4 3-2" />
  </Base>
);

export const ExternalLinkIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
  </Base>
);

export const ArrowUpRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Base>
);

export const DownloadIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
  </Base>
);

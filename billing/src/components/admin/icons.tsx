// Clean, stroke-based nav icons (currentColor, 24-grid). Kept in one place so
// the collapsed icon-rail stays legible and consistent.
type Props = { className?: string };

const S = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className ?? "h-5 w-5"}
    aria-hidden
  >
    {children}
  </svg>
);

export const NAV_ICONS = {
  overview: (p: Props) => (
    <S className={p.className}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </S>
  ),
  vendors: (p: Props) => (
    <S className={p.className}>
      <path d="M3 9.5 5 4h14l2 5.5" />
      <path d="M4 9.5v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-10" />
      <path d="M3 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 3 0" />
      <path d="M9 20.5v-5h6v5" />
    </S>
  ),
  requests: (p: Props) => (
    <S className={p.className}>
      <path d="M12 21a9 9 0 1 0-9-9" />
      <path d="M12 16V8" />
      <path d="m8.5 11.5 3.5-3.5 3.5 3.5" />
      <path d="M3 12H1.5M4.2 6.2 3 5" />
    </S>
  ),
  payments: (p: Props) => (
    <S className={p.className}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 9.5h19" />
      <path d="M6 15h4" />
    </S>
  ),
  audit: (p: Props) => (
    <S className={p.className}>
      <path d="M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 16 20.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5Z" />
      <path d="M9.5 8h5M9.5 12h5M9.5 16h3" />
    </S>
  ),
  users: (p: Props) => (
    <S className={p.className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6" />
      <path d="M17 14.4A5.5 5.5 0 0 1 20.5 19.5" />
    </S>
  ),
  settings: (p: Props) => (
    <S className={p.className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.1a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 20l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4 15a1.6 1.6 0 0 0-1.5-1H2.4a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4 8.6a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6h.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.1a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </S>
  ),
} as const;

export type NavIconName = keyof typeof NAV_ICONS;

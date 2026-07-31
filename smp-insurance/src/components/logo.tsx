/**
 * SMP Insurance Agency logomark — a shield with an "S" ribbon.
 * Pure SVG so it scales crisply everywhere; swap for the client's official
 * logo file if one exists.
 */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id="smp-shield" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d4477" />
          <stop offset="1" stopColor="#0b2545" />
        </linearGradient>
      </defs>
      <path
        d="M24 3l16.5 6.2v11.2c0 10.2-6.8 17.6-16.5 21.6C14.3 38 7.5 30.6 7.5 20.4V9.2z"
        fill="url(#smp-shield)"
      />
      <path
        d="M24 6.2l13.6 5.1v9.6c0 8.7-5.7 15.1-13.6 18.7-7.9-3.6-13.6-10-13.6-18.7v-9.6z"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.6"
        opacity="0.9"
      />
      <path
        d="M30.2 17.4c-1.2-1.9-3.4-3-5.9-3-3.6 0-6.3 2-6.3 4.9 0 6 12 3.6 12 7.6 0 1.6-1.9 2.8-4.4 2.8-2.6 0-4.7-1.2-5.8-3.2"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({
  className = "",
  dark = false,
}: {
  className?: string;
  dark?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className="leading-tight">
        <span
          className={`block font-display text-lg font-extrabold tracking-tight ${
            dark ? "text-white" : "text-navy-900"
          }`}
        >
          SMP Insurance
        </span>
        <span
          className={`block text-[10px] font-bold uppercase tracking-[0.32em] ${
            dark ? "text-navy-300" : "text-slate-500"
          }`}
        >
          Agency
        </span>
      </span>
    </span>
  );
}

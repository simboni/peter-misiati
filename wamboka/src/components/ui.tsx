import type { Source, Verification } from "@/lib/data";

/* ------------------------------------------------------------- status pill */

const statusStyles: Record<Verification, string> = {
  verified: "bg-green-400/10 text-green-600 ring-green-400/30",
  reported: "bg-amber-100 text-amber-500 ring-amber-500/25",
  pending: "bg-paper-700 text-ink-500 ring-paper-500/60",
};

const statusLabel: Record<Verification, string> = {
  verified: "Verified",
  reported: "Reported",
  pending: "Pending official record",
};

export function StatusBadge({ status }: { status: Verification }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase ring-1 ${statusStyles[status]}`}
    >
      <span
        className={`inline-block size-1.5 rounded-full ${
          status === "verified"
            ? "bg-green-400"
            : status === "reported"
              ? "bg-amber-500"
              : "bg-ink-600"
        }`}
      />
      {statusLabel[status]}
    </span>
  );
}

/* ------------------------------------------------------------ source chips */

export function SourceChips({ sources }: { sources: Source[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {sources.map((s) => (
        <a
          key={s.url + s.name}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1 rounded border border-paper-600 bg-paper-800 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 transition hover:border-green-400 hover:text-green-600"
          title={s.name}
        >
          <svg viewBox="0 0 12 12" className="size-2.5 shrink-0 fill-current opacity-60">
            <path d="M4.5 1.5H2A1.5 1.5 0 0 0 .5 3v7A1.5 1.5 0 0 0 2 11.5h7A1.5 1.5 0 0 0 10.5 10V7.5h-1.4V10a.1.1 0 0 1-.1.1H2a.1.1 0 0 1-.1-.1V3a.1.1 0 0 1 .1-.1h2.5ZM6.7.5v1.4h2.4L4.6 6.4l1 1 4.5-4.5v2.4h1.4V.5Z" />
          </svg>
          <span className="truncate">{s.name}</span>
        </a>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------ section head */

export function SectionHead({
  kicker,
  title,
  lede,
}: {
  kicker: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className="max-w-3xl">
      <p className="font-mono text-xs font-medium tracking-[0.2em] text-green-600 uppercase">
        {kicker}
      </p>
      <h2 className="mt-3 font-display text-3xl font-semibold text-ink-100 sm:text-4xl">
        {title}
      </h2>
      {lede ? <p className="mt-4 text-base leading-relaxed text-ink-400">{lede}</p> : null}
    </header>
  );
}

/* --------------------------------------------------------------- fact card */

export function FactRow({
  claim,
  detail,
  date,
  status,
  sources,
}: {
  claim: string;
  detail?: string;
  date: string;
  status: Verification;
  sources: Source[];
}) {
  return (
    <li className="rounded-lg border border-paper-600 bg-paper-800 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-ink-500">{date}</span>
        <StatusBadge status={status} />
      </div>
      <p className="mt-2 font-medium text-ink-200">{claim}</p>
      {detail ? <p className="mt-1.5 text-sm leading-relaxed text-ink-400">{detail}</p> : null}
      <div className="mt-3">
        <SourceChips sources={sources} />
      </div>
    </li>
  );
}

import Link from "next/link";
import type { Ministry } from "@/lib/site";
import { MinistryIcon, ArrowRightIcon } from "@/components/icons";

const accentMap: Record<
  Ministry["accent"],
  { chip: string; icon: string; hoverBorder: string }
> = {
  terra: { chip: "bg-terra-50 text-terra-600", icon: "text-terra-600", hoverBorder: "hover:border-terra-300" },
  gold: { chip: "bg-gold-200/40 text-gold-600", icon: "text-gold-600", hoverBorder: "hover:border-gold-400" },
  sky: { chip: "bg-sky-500/10 text-sky-600", icon: "text-sky-600", hoverBorder: "hover:border-sky-400" },
  sage: { chip: "bg-sage-500/12 text-sage-600", icon: "text-sage-600", hoverBorder: "hover:border-sage-400" },
};

export function MinistryCard({ ministry }: { ministry: Ministry }) {
  const a = accentMap[ministry.accent];
  return (
    <Link
      href={`/ministries/${ministry.slug}`}
      className={`spotlight group card flex flex-col overflow-hidden p-0 transition-all duration-300 hover:-translate-y-1 ${a.hoverBorder}`}
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ministry.image}
          alt={ministry.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/45 via-transparent to-transparent" />
        <span
          className={`absolute left-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-cream-50/95 shadow-sm ${a.icon}`}
        >
          <MinistryIcon name={ministry.icon} className="h-5.5 w-5.5" />
        </span>
      </div>
      <div className="flex flex-1 flex-col p-6">
        <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${a.chip}`}>
          {ministry.tagline}
        </span>
        <h3 className="mt-3 font-display text-xl font-semibold text-ink-900 group-hover:text-terra-600">
          {ministry.name}
        </h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600">{ministry.summary}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-terra-600">
          Learn more
          <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

import Link from "next/link";
import { methodology, nav, site } from "@/lib/data";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-paper-600 bg-paper-850">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <p className="font-display text-lg font-bold text-ink-100">
              Wamboka <span className="text-green-600">· The Record</span>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              A sourced, statused public record — achievements and adverse findings alike.
              If a claim on this site has no source chip, it does not belong here.
            </p>
          </div>
          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-ink-400 transition hover:text-green-600">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-8 border-t border-paper-600 pt-5">
          <p className="font-mono text-[11px] leading-relaxed text-ink-600">
            {methodology.disclaimer}
          </p>
          <p className="mt-3 font-mono text-[11px] text-ink-600">
            Last updated {site.updated}.
          </p>
        </div>
      </div>
      <div className="kenya-band h-1" aria-hidden />
    </footer>
  );
}

import Link from "next/link";
import { BUSINESS, telHref, WA_GENERAL } from "@/lib/business";
import { SiteNav } from "@/components/site-nav";
import { PhoneIcon, WhatsAppIcon } from "@/components/ui";
import { logoSrc } from "@/lib/brand";

/**
 * The phone number is the point of the whole site, so it sits in the header on
 * every page and stays reachable in one tap on a phone.
 */
export function SiteHeader() {
  const logo = logoSrc();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      {/* The signboard's green, used at full strength where no text sits on it. */}
      <div aria-hidden="true" className="h-1 bg-leaf" />

      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label={`${BUSINESS.name} — home`}>
          {logo ? (
            <img
              src={logo}
              alt=""
              aria-hidden="true"
              width={160}
              height={96}
              className="h-11 w-auto shrink-0 object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-extrabold text-white"
            >
              RZ
            </span>
          )}
          <span className="leading-tight">
            <span className="block text-sm font-extrabold tracking-tight sm:text-base">
              Riziki Industrial Chemicals
            </span>
            <span className="block text-[11px] font-semibold text-muted sm:text-xs">
              {BUSINESS.tagline}
            </span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={telHref}
            className="hidden items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-bold text-ink hover:bg-surface-2 sm:inline-flex"
          >
            <PhoneIcon />
            {BUSINESS.phoneDisplay}
          </a>
          <a
            href={telHref}
            aria-label={`Call ${BUSINESS.phoneDisplay}`}
            className="inline-flex items-center justify-center rounded-xl border border-line p-2.5 text-ink hover:bg-surface-2 sm:hidden"
          >
            <PhoneIcon className="h-5 w-5" />
          </a>
          <a
            href={WA_GENERAL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-leaf-strong px-3 py-2.5 text-sm font-bold text-white hover:brightness-95"
          >
            <WhatsAppIcon />
            <span className="hidden sm:inline">WhatsApp</span>
            <span className="sr-only sm:hidden">WhatsApp us</span>
          </a>
        </div>
      </div>

      <SiteNav />
    </header>
  );
}

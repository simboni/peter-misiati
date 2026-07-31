import Link from "next/link";
import { Logo } from "@/components/logo";
import { MailIcon, MapPinIcon, PhoneIcon, WhatsAppIcon, ClockIcon } from "@/components/icons";
import { products } from "@/lib/products";
import { site, waLink, defaultWaMessage } from "@/lib/site";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-navy-950 text-navy-200">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <Logo dark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-navy-300">
              Independent insurance agency in Nairobi. We compare Kenya&apos;s
              leading underwriters, handle the paperwork, and fight for your
              claims.
            </p>
            <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs leading-relaxed">
              Regulated by the Insurance Regulatory Authority (IRA)
              <br />
              Licence No. {site.iraLicence} · Verify at{" "}
              <a
                href="https://www.ira.go.ke"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-white underline-offset-2 hover:underline"
              >
                ira.go.ke
              </a>
            </p>
          </div>

          <nav aria-label="Products">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-navy-300">
              Products
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {products.slice(0, 7).map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/products/${p.slug}/`}
                    className="transition hover:text-white"
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/products/" className="font-semibold text-white transition hover:text-cta-300">
                  All products →
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Company">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-navy-300">
              Company
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><Link href="/about/" className="transition hover:text-white">About us</Link></li>
              <li><Link href="/claims/" className="transition hover:text-white">Claims support</Link></li>
              <li><Link href="/faq/" className="transition hover:text-white">FAQ</Link></li>
              <li><Link href="/quote/" className="transition hover:text-white">Get a quote</Link></li>
              <li><Link href="/contact/" className="transition hover:text-white">Contact</Link></li>
            </ul>
          </nav>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-navy-300">
              Talk to us
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a href={`tel:${site.phoneHref}`} className="inline-flex items-start gap-2.5 transition hover:text-white">
                  <PhoneIcon className="mt-0.5 h-4 w-4 shrink-0" /> {site.phone}
                </a>
              </li>
              <li>
                <a
                  href={waLink(defaultWaMessage)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-start gap-2.5 transition hover:text-white"
                >
                  <WhatsAppIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#25D366]" />
                  WhatsApp us
                </a>
              </li>
              <li>
                <a href={`mailto:${site.email}`} className="inline-flex items-start gap-2.5 transition hover:text-white">
                  <MailIcon className="mt-0.5 h-4 w-4 shrink-0" /> {site.email}
                </a>
              </li>
              <li className="inline-flex items-start gap-2.5">
                <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {site.address.street}, {site.address.city}
                  <br />
                  {site.address.poBox}
                </span>
              </li>
              <li className="inline-flex items-start gap-2.5">
                <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />
                {site.hours}
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 text-xs text-navy-300 sm:flex-row sm:items-center">
          <p>
            © {year} {site.legalName}. All rights reserved.
          </p>
          <p>
            Insurance products are underwritten by IRA-licensed underwriters.
            Policy terms and conditions apply.
          </p>
        </div>
      </div>
    </footer>
  );
}

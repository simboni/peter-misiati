import Link from "next/link";
import { BUSINESS, telHref, WA_GENERAL } from "@/lib/business";
import { Container, PhoneIcon, WhatsAppIcon } from "@/components/ui";

const YEAR = new Date().getFullYear();

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <Container className="py-10">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <h2 className="text-sm font-extrabold tracking-tight">{BUSINESS.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {BUSINESS.tagline}. Raw chemicals in bulk and small packs, finished cleaning
              products and measured mix kits.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {BUSINESS.address.building}, {BUSINESS.address.street},{" "}
              {BUSINESS.address.area} · {BUSINESS.hours.days} {BUSINESS.hours.open} –{" "}
              {BUSINESS.hours.close}
            </p>
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Pages</h2>
            <ul className="mt-3 space-y-2 text-sm font-semibold">
              <li>
                <Link href="/" className="hover:text-accent">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/about/" className="hover:text-accent">
                  About us
                </Link>
              </li>
              <li>
                <Link href="/products/" className="hover:text-accent">
                  Products &amp; catalogue
                </Link>
              </li>
              <li>
                <Link href="/contact/" className="hover:text-accent">
                  Contact &amp; enquiries
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Order</h2>
            <ul className="mt-3 space-y-2 text-sm font-semibold">
              <li>
                <a href={telHref} className="inline-flex items-center gap-2 hover:text-accent">
                  <PhoneIcon />
                  {BUSINESS.phoneDisplay}
                </a>
              </li>
              <li>
                <a
                  href={WA_GENERAL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 hover:text-accent"
                >
                  <WhatsAppIcon />
                  WhatsApp the same number
                </a>
              </li>
            </ul>
          </div>
        </div>

        <p className="mt-8 border-t border-line pt-6 text-xs leading-relaxed text-muted">
          © {YEAR} {BUSINESS.name}. Chemicals are supplied for their intended use — please
          follow the handling and storage advice given at the counter, and keep all products out
          of reach of children.
        </p>
      </Container>
    </footer>
  );
}

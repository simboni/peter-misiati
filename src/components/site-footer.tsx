import Link from "next/link";
import { nav, contact, site, locations } from "@/lib/site";
import { Logo } from "@/components/logo";
import { NewsletterForm } from "@/components/newsletter-form";
import {
  PhoneIcon,
  MailIcon,
  PinIcon,
  FacebookIcon,
  InstagramIcon,
  YouTubeIcon,
} from "@/components/icons";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-8 border-t border-terra-800 bg-terra-900 text-cream-200">
      {/* Newsletter band */}
      <div className="border-b border-terra-800 bg-terra-800/60">
        <div className="container-page grid gap-6 py-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="font-display text-2xl font-semibold text-cream-50">
              Stay close to the mission
            </h2>
            <p className="mt-2 max-w-md text-sm text-cream-200/80">
              Subscribe for stories and updates from the North East Africa Province.
            </p>
          </div>
          <NewsletterForm />
        </div>
      </div>

      <div className="container-page grid gap-10 py-14 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Logo uid="ftr" invert />
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-cream-200/80">
            {site.name} — Servants of the Poor. We serve the poor, needy and marginalized
            across the {site.province}.
          </p>
          <div className="mt-6 flex items-center gap-3">
            <SocialLink href={contact.socials.facebook} label="Facebook">
              <FacebookIcon className="h-4.5 w-4.5" />
            </SocialLink>
            <SocialLink href={contact.socials.instagram} label="Instagram">
              <InstagramIcon className="h-4.5 w-4.5" />
            </SocialLink>
            <SocialLink href={contact.socials.youtube} label="YouTube">
              <YouTubeIcon className="h-4.5 w-4.5" />
            </SocialLink>
          </div>
        </div>

        <div className="lg:col-span-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-300">
            Explore
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-cream-200/80 transition-colors hover:text-gold-300">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/donate" className="text-cream-200/80 transition-colors hover:text-gold-300">
                Donate
              </Link>
            </li>
          </ul>
        </div>

        <div className="lg:col-span-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-300">
            Our locations
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-cream-200/80">
            {locations.map((l) => (
              <li key={l.country}>
                <span className="font-medium text-cream-100">{l.country}</span> — {l.note}
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-300">
            Get in touch
          </h3>
          <ul className="mt-4 space-y-3 text-sm text-cream-200/80">
            <li className="flex items-start gap-2.5">
              <PinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" />
              <span>
                {contact.address.org}
                <br />
                {contact.address.lines.join(", ")}
              </span>
            </li>
            <li>
              <a href={contact.phoneHref} className="flex items-center gap-2.5 hover:text-gold-300">
                <PhoneIcon className="h-4 w-4 shrink-0 text-gold-300" /> {contact.phone}
              </a>
            </li>
            <li>
              <a href={`mailto:${contact.email}`} className="flex items-center gap-2.5 break-all hover:text-gold-300">
                <MailIcon className="h-4 w-4 shrink-0 text-gold-300" /> {contact.email}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-terra-800">
        <div className="container-page flex flex-col gap-3 py-6 text-xs text-cream-200/70 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} {site.shortName}. All rights reserved.</p>
          <p className="italic text-gold-300/90">Caritas Christi Urget Nos</p>
        </div>
      </div>
    </footer>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-terra-700 text-cream-200 transition-colors hover:border-gold-400 hover:text-gold-300"
    >
      {children}
    </a>
  );
}

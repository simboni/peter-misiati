import Link from "next/link";
import { nav, programs, contact, site } from "@/lib/cosdep";
import { Logo } from "@/components/logo";
import {
  MailIcon,
  PhoneIcon,
  PinIcon,
  FacebookIcon,
  YouTubeIcon,
  InstagramIcon,
  LinkedInIcon,
  XIcon,
} from "@/components/icons";

export function SiteFooter() {
  const year = 2026;
  return (
    <footer className="mt-auto bg-forest-950 text-forest-100/70">
      <div className="container-page py-16">
        <div className="grid gap-12 lg:grid-cols-12">
          {/* Brand */}
          <div className="lg:col-span-4">
            <Logo onDark />
            <p className="mt-6 max-w-xs text-sm leading-relaxed">
              {site.fullName} — a registered Kenyan NGO training farmers to
              secure their future through agro-ecological agriculture.
            </p>
            <div className="mt-6 flex gap-2.5">
              <SocialLink href={contact.socials.facebook} label="Facebook">
                <FacebookIcon className="h-4.5 w-4.5" />
              </SocialLink>
              <SocialLink href={contact.socials.youtube} label="YouTube">
                <YouTubeIcon className="h-4.5 w-4.5" />
              </SocialLink>
              <SocialLink href={contact.socials.instagram} label="Instagram">
                <InstagramIcon className="h-4.5 w-4.5" />
              </SocialLink>
              <SocialLink href={contact.socials.twitter} label="X (Twitter)">
                <XIcon className="h-4 w-4" />
              </SocialLink>
              <SocialLink href={contact.socials.linkedin} label="LinkedIn">
                <LinkedInIcon className="h-4.5 w-4.5" />
              </SocialLink>
            </div>
          </div>

          {/* Explore */}
          <div className="lg:col-span-2">
            <h3 className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-leaf-400">
              Explore
            </h3>
            <ul className="mt-4 space-y-3 text-sm">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="transition-colors hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Programmes */}
          <div className="lg:col-span-3">
            <h3 className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-leaf-400">
              Programmes
            </h3>
            <ul className="mt-4 space-y-3 text-sm">
              {programs.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/programs#${p.slug}`}
                    className="transition-colors hover:text-white"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div className="lg:col-span-3">
            <h3 className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-leaf-400">
              Get in touch
            </h3>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="flex gap-3">
                <PinIcon className="mt-0.5 h-4.5 w-4.5 shrink-0 text-forest-400" />
                <span>
                  {contact.poBox}
                  <br />
                  {contact.location}
                </span>
              </li>
              <li>
                <a
                  href={`tel:${contact.phone.replace(/\s/g, "")}`}
                  className="flex items-center gap-3 transition-colors hover:text-white"
                >
                  <PhoneIcon className="h-4.5 w-4.5 shrink-0 text-forest-400" />
                  {contact.phoneDisplay}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-3 transition-colors hover:text-white"
                >
                  <MailIcon className="h-4.5 w-4.5 shrink-0 text-forest-400" />
                  {contact.email}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-forest-800/60 pt-6 text-xs text-forest-100/50 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {site.fullName}. All rights reserved.
          </p>
          <p>Growing food security, one farmer at a time.</p>
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
      aria-label={label}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-forest-800/60 text-forest-100/80 transition-colors hover:bg-leaf-500 hover:text-forest-900"
    >
      {children}
    </a>
  );
}

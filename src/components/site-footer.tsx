import Link from "next/link";
import { nav, profile, projects } from "@/lib/portfolio";
import { Logo } from "@/components/logo";
import {
  MailIcon,
  GitHubIcon,
  LinkedInIcon,
  XIcon,
  ArrowUpRightIcon,
} from "@/components/icons";

export function SiteFooter() {
  const year = 2026;
  return (
    <footer className="border-t border-ink-700 bg-ink-950">
      <div className="container-page py-16">
        <div className="grid gap-12 lg:grid-cols-12">
          {/* Brand */}
          <div className="lg:col-span-5">
            <Logo uid="ftr" />
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-mist-400">
              {profile.valueProp}
            </p>
            <div className="mt-6 flex gap-2.5">
              {profile.socials.github && (
                <SocialLink href={profile.socials.github} label="GitHub">
                  <GitHubIcon className="h-5 w-5" />
                </SocialLink>
              )}
              {profile.socials.linkedin && (
                <SocialLink href={profile.socials.linkedin} label="LinkedIn">
                  <LinkedInIcon className="h-5 w-5" />
                </SocialLink>
              )}
              {profile.socials.x && (
                <SocialLink href={profile.socials.x} label="X">
                  <XIcon className="h-4 w-4" />
                </SocialLink>
              )}
              <SocialLink href={`mailto:${profile.email}`} label="Email">
                <MailIcon className="h-5 w-5" />
              </SocialLink>
            </div>
          </div>

          {/* Explore */}
          <div className="lg:col-span-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-mist-500">
              Explore
            </h3>
            <ul className="mt-4 space-y-3 text-sm">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-mist-400 transition-colors hover:text-green-300"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Work */}
          <div className="lg:col-span-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-mist-500">
              Selected work
            </h3>
            <ul className="mt-4 space-y-3 text-sm">
              {projects.slice(0, 4).map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/work/${p.slug}`}
                    className="text-mist-400 transition-colors hover:text-green-300"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/work"
                  className="inline-flex items-center gap-1 font-medium text-green-400 transition-colors hover:text-green-300"
                >
                  view all <ArrowUpRightIcon className="h-3.5 w-3.5" />
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-ink-700 pt-6 font-mono text-xs text-mist-600 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} {profile.name}</p>
          <p>designed &amp; built by SMP Developers</p>
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
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      aria-label={label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-ink-600 bg-ink-800 text-mist-300 transition-colors hover:border-green-400/50 hover:text-green-400"
    >
      {children}
    </a>
  );
}

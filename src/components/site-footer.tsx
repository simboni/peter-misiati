import Link from "next/link";
import { nav, programs, site } from "@/lib/keysa";
import { Logo } from "@/components/logo";
import { HeartIcon, MailIcon, MapPinIcon } from "@/components/icons";

export function SiteFooter() {
  return (
    <footer className="border-t border-ink-600 bg-ink-850">
      <div className="tricolor" aria-hidden />
      <div className="container-page grid gap-12 py-14 md:grid-cols-2 lg:grid-cols-4">
        {/* Identity */}
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-mist-400">
            Cultivating and empowering young people in Kakamega County and beyond —
            fostering sustainable, self-reliant communities through leadership,
            mentorship and community engagement.
          </p>
          <p className="mt-4 flex items-start gap-2 text-sm text-mist-500">
            <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {site.location}
          </p>
          <a
            href={`mailto:${site.email}`}
            className="mt-2 flex items-center gap-2 text-sm text-mist-500 transition-colors hover:text-green-300"
          >
            <MailIcon className="h-4 w-4 shrink-0" />
            {site.email}
          </a>
        </div>

        {/* Explore */}
        <nav aria-label="Footer">
          <h3 className="kicker mb-4">Explore</h3>
          <ul className="space-y-2.5 text-sm">
            {[{ href: "/", label: "Home" }, ...nav, { href: "/donate/", label: "Donate" }].map(
              (item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-mist-400 transition-colors hover:text-mist-100"
                  >
                    {item.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>

        {/* Programs */}
        <nav aria-label="Programs">
          <h3 className="kicker mb-4">Our Programs</h3>
          <ul className="space-y-2.5 text-sm">
            {programs.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/programs/${p.slug}/`}
                  className="text-mist-400 transition-colors hover:text-mist-100"
                >
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Give */}
        <div>
          <h3 className="kicker mb-4">Make a Difference</h3>
          <p className="text-sm leading-relaxed text-mist-400">
            Every contribution — funds, skills, mentorship or equipment — moves a
            young person closer to their potential.
          </p>
          <Link
            href="/donate/"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent-400 px-5 py-2.5 text-sm font-semibold text-on-red transition-colors hover:bg-accent-500"
          >
            <HeartIcon className="h-4 w-4" />
            Support our work
          </Link>
          <p className="mt-4 text-xs leading-relaxed text-mist-500">
            KEYSA is a registered non-profit association in Kenya, founded in{" "}
            {site.founded}.
          </p>
        </div>
      </div>

      <div className="border-t border-ink-600 py-6">
        <div className="container-page flex flex-col items-center justify-between gap-3 text-xs text-mist-500 sm:flex-row">
          <p>
            © {new Date().getFullYear()} {site.name}. All rights reserved.
          </p>
          <p>
            Harambee — <span className="text-mist-400">together we build the leaders of tomorrow.</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

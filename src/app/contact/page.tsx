import type { Metadata } from "next";
import { contact } from "@/lib/cosdep";
import { PageHero } from "@/components/page-hero";
import { Section, Eyebrow } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";
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

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with COSDEP — to donate, volunteer, partner, or learn more about our agro-ecological programmes in Kenya.",
};

const details = [
  {
    icon: PinIcon,
    label: "Visit / write to us",
    lines: [contact.poBox, contact.location],
  },
  {
    icon: PhoneIcon,
    label: "Call us",
    lines: [contact.phoneDisplay],
    href: `tel:${contact.phone.replace(/\s/g, "")}`,
  },
  {
    icon: MailIcon,
    label: "Email us",
    lines: [contact.email],
    href: `mailto:${contact.email}`,
  },
];

const socials = [
  { icon: FacebookIcon, href: contact.socials.facebook, label: "Facebook" },
  { icon: YouTubeIcon, href: contact.socials.youtube, label: "YouTube" },
  { icon: InstagramIcon, href: contact.socials.instagram, label: "Instagram" },
  { icon: XIcon, href: contact.socials.twitter, label: "X (Twitter)" },
  { icon: LinkedInIcon, href: contact.socials.linkedin, label: "LinkedIn" },
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Let's talk"
        intro="Have a question, an idea or want to get involved? We'd love to hear from you."
        image="/images/cosdep-signboard.jpg"
      />

      <Section>
        <div className="grid gap-12 lg:grid-cols-5 lg:gap-16">
          {/* Details */}
          <div className="lg:col-span-2">
            <Eyebrow>Get in touch</Eyebrow>
            <h2 className="mt-4 font-display text-2xl font-bold text-ink-900">
              We&rsquo;re here to help
            </h2>
            <p className="mt-3 text-ink-500">
              Reach us directly, or send a message and we&rsquo;ll get back to
              you as soon as we can.
            </p>

            <ul className="mt-8 space-y-5">
              {details.map((d) => {
                const Icon = d.icon;
                const body = (
                  <div className="flex gap-4">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-forest-50 text-forest-600">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-display text-sm font-semibold text-ink-900">
                        {d.label}
                      </p>
                      {d.lines.map((l) => (
                        <p key={l} className="text-sm text-ink-500">
                          {l}
                        </p>
                      ))}
                    </div>
                  </div>
                );
                return (
                  <li key={d.label}>
                    {d.href ? (
                      <a
                        href={d.href}
                        className="block rounded-xl transition-colors hover:bg-sand-50"
                      >
                        {body}
                      </a>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-8">
              <p className="font-display text-sm font-semibold text-ink-900">
                Follow our work
              </p>
              <div className="mt-3 flex gap-2.5">
                {socials.map((s) => {
                  const Icon = s.icon;
                  return (
                    <a
                      key={s.label}
                      href={s.href}
                      aria-label={s.label}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-sand-100 text-forest-700 transition-colors hover:bg-forest-600 hover:text-white"
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </a>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="lg:col-span-3">
            <ContactForm />
          </div>
        </div>
      </Section>
    </>
  );
}

import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { Section } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";
import { Faq } from "@/components/faq";
import {
  PhoneIcon,
  MailIcon,
  PinIcon,
  FacebookIcon,
  InstagramIcon,
  YouTubeIcon,
} from "@/components/icons";
import { contact, faqs } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact Us",
  description:
    "Reach the Canossian Sisters of the North East Africa Province — Provincial House, Dar es Salaam, Tanzania. Enquire, volunteer, or ask for prayer.",
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        crumb="Contact"
        eyebrow="Get in touch"
        title="We would love to hear from you"
        intro="Whether you wish to volunteer, support a cause, request prayer, or simply learn more — a Sister will be glad to reply."
      />

      <Section className="bg-cream-50">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h2 className="font-display text-2xl font-semibold text-ink-900">Contact details</h2>
            <p className="mt-3 text-ink-600">
              Our Provincial House coordinates the mission across the Province.
            </p>

            <ul className="mt-8 space-y-5">
              <ContactRow icon={<PinIcon className="h-5 w-5" />} title="Provincial House">
                {contact.address.org}
                <br />
                {contact.address.lines.join(", ")}
              </ContactRow>
              <ContactRow icon={<PhoneIcon className="h-5 w-5" />} title="Call us">
                <a href={contact.phoneHref} className="hover:text-terra-600">
                  {contact.phone}
                </a>
              </ContactRow>
              <ContactRow icon={<MailIcon className="h-5 w-5" />} title="Email">
                <a href={`mailto:${contact.email}`} className="break-all hover:text-terra-600">
                  {contact.email}
                </a>
              </ContactRow>
            </ul>

            <div className="mt-8">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-terra-500">
                Follow us
              </h3>
              <div className="mt-3 flex items-center gap-3">
                <Social href={contact.socials.facebook} label="Facebook">
                  <FacebookIcon className="h-4.5 w-4.5" />
                </Social>
                <Social href={contact.socials.instagram} label="Instagram">
                  <InstagramIcon className="h-4.5 w-4.5" />
                </Social>
                <Social href={contact.socials.youtube} label="YouTube">
                  <YouTubeIcon className="h-4.5 w-4.5" />
                </Social>
              </div>
            </div>

            <div className="mt-8 overflow-hidden rounded-2xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/church-1.jpg" alt="A place of prayer" className="h-48 w-full object-cover" />
            </div>
          </div>

          <div className="lg:col-span-7">
            <ContactForm />
          </div>
        </div>
      </Section>

      <Section className="bg-cream-100">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center font-display text-3xl font-semibold text-ink-900">
            Common questions
          </h2>
          <div className="mt-8">
            <Faq items={faqs} />
          </div>
        </div>
      </Section>
    </>
  );
}

function ContactRow({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-4">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-terra-50 text-terra-600">
        {icon}
      </span>
      <div>
        <div className="text-sm font-semibold text-ink-900">{title}</div>
        <div className="mt-0.5 text-ink-600">{children}</div>
      </div>
    </li>
  );
}

function Social({
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
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line-strong text-ink-700 transition-colors hover:border-terra-400 hover:text-terra-600"
    >
      {children}
    </a>
  );
}

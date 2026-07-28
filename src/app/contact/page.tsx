import type { Metadata } from "next";
import { site } from "@/lib/keysa";
import { PageHero } from "@/components/page-hero";
import { ContactForm } from "@/components/contact-form";
import { Reveal } from "@/components/reveal";
import { CopyButton } from "@/components/copy-button";
import { GlobeIcon, MailIcon, MapPinIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with the Kenya Youth Support Association — donations, partnerships, volunteering, media and general enquiries. We reply to every message.",
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to a person, not a machine"
        lede="Every message to KEYSA is read by a board member. Whether you're a donor, a potential partner, a journalist or a young person looking for support — we want to hear from you."
      />

      <section className="py-16 sm:py-20">
        <div className="container-page grid gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-5">
            <Reveal>
              <div className="win p-7">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-400/10 text-green-400">
                  <MailIcon className="h-5.5 w-5.5" />
                </span>
                <h2 className="mt-4 font-display text-lg font-bold text-mist-100">Email</h2>
                <p className="mt-1 text-sm text-mist-400">
                  The fastest way to reach the team.
                </p>
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-ink-600 bg-ink-900 px-4 py-3">
                  <a
                    href={`mailto:${site.email}`}
                    className="truncate text-sm font-medium text-green-400 hover:underline"
                  >
                    {site.email}
                  </a>
                  <CopyButton value={site.email} label="email address" />
                </div>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="win p-7">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-400/10 text-green-400">
                  <MapPinIcon className="h-5.5 w-5.5" />
                </span>
                <h2 className="mt-4 font-display text-lg font-bold text-mist-100">
                  Where we work
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-mist-400">
                  {site.location}. Our programs currently serve Namamali Ward and the
                  wider Matungu Constituency.
                </p>
              </div>
            </Reveal>
            <Reveal delay={160}>
              <div className="win p-7">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-400/10 text-green-400">
                  <GlobeIcon className="h-5.5 w-5.5" />
                </span>
                <h2 className="mt-4 font-display text-lg font-bold text-mist-100">Online</h2>
                <p className="mt-1 text-sm leading-relaxed text-mist-400">
                  {site.domain} — and our community channels, where meeting updates
                  and program news are shared first.
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal delay={100}>
            <div>
              <h2 className="mb-4 font-display text-xl font-bold text-mist-100">
                Send us a message
              </h2>
              <ContactForm />
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Container, SectionHeading, btnWhatsApp, btnPrimary, Card } from "@/components/ui";
import { MailIcon, MapPinIcon, PhoneIcon, WhatsAppIcon, ClockIcon, ArrowRightIcon } from "@/components/icons";
import { site, waLink, defaultWaMessage } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact Us — Nairobi Insurance Agency",
  description: `Talk to ${site.name}: call ${site.phone}, WhatsApp us, or visit our Nairobi office. ${site.quotePromise}.`,
};

export default function ContactPage() {
  return (
    <>
      <section className="bg-navy-950 py-14 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="Contact"
            title="Talk to a human, fast"
            lead="Quotes, claims, renewals or just a question — reach us on the channel you prefer. WhatsApp is usually the quickest."
            align="left"
            dark
          />
        </Container>
      </section>

      <section className="py-14 sm:py-20">
        <Container>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <WhatsAppIcon className="h-7 w-7 text-[#25D366]" />
              <h2 className="mt-3 font-display text-base font-bold text-slate-900">WhatsApp</h2>
              <p className="mt-1 text-sm text-slate-500">
                Fastest for quotes, documents and claims.
              </p>
              <a
                href={waLink(defaultWaMessage)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-navy-600 hover:text-navy-500"
              >
                Start a chat <ArrowRightIcon className="h-4 w-4" />
              </a>
            </Card>
            <Card>
              <PhoneIcon className="h-7 w-7 text-navy-600" />
              <h2 className="mt-3 font-display text-base font-bold text-slate-900">Call us</h2>
              <p className="mt-1 text-sm text-slate-500">{site.hours}</p>
              <a
                href={`tel:${site.phoneHref}`}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-navy-600 hover:text-navy-500"
              >
                {site.phone}
              </a>
            </Card>
            <Card>
              <MailIcon className="h-7 w-7 text-navy-600" />
              <h2 className="mt-3 font-display text-base font-bold text-slate-900">Email</h2>
              <p className="mt-1 text-sm text-slate-500">
                For documents and formal correspondence.
              </p>
              <a
                href={`mailto:${site.email}`}
                className="mt-4 inline-flex items-center gap-1.5 break-all text-sm font-bold text-navy-600 hover:text-navy-500"
              >
                {site.email}
              </a>
            </Card>
            <Card>
              <MapPinIcon className="h-7 w-7 text-navy-600" />
              <h2 className="mt-3 font-display text-base font-bold text-slate-900">Visit us</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                {site.address.street}
                <br />
                {site.address.city}, {site.address.country}
                <br />
                {site.address.poBox}
              </p>
            </Card>
          </div>

          <div className="mt-10 grid items-center gap-8 rounded-2xl border border-paper-300 bg-paper-50 p-8 shadow-sm md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900">
                Not sure what cover you need?
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
                Start the 2-minute quote form — it asks the right questions,
                and a real person follows up with options. {site.quotePromise}.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/quote/" className={btnPrimary}>
                Get a quote
              </Link>
              <a href={waLink(defaultWaMessage)} target="_blank" rel="noopener noreferrer" className={btnWhatsApp}>
                <WhatsAppIcon className="h-5 w-5" /> WhatsApp
              </a>
            </div>
          </div>

          <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs text-slate-500">
            <ClockIcon className="h-4 w-4" />
            {site.hours} — messages outside hours are answered first thing the
            next working day.
          </p>
        </Container>
      </section>
    </>
  );
}

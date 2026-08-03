import type { Metadata } from "next";
import { BUSINESS, telHref, WA_GENERAL, WA_PRICE_LIST } from "@/lib/business";
import {
  Card,
  Container,
  PhoneIcon,
  Section,
  ToConfirm,
  WhatsAppIcon,
} from "@/components/ui";
import { openGraphFor } from "@/lib/seo";
import { EnquiryForm } from "./enquiry-form";

export const metadata: Metadata = {
  title: "Contact & enquiries",
  description:
    "Call or WhatsApp Riziki Industrial Chemicals on +254 723 496 434 for prices, availability and advice on industrial chemicals in Nairobi. Send your list and we will quote you the same day.",
  alternates: { canonical: "/contact/" },
  openGraph: openGraphFor({
    title: `Contact ${BUSINESS.name}`,
    description:
      "Call or WhatsApp +254 723 496 434 for prices, availability and advice. Nairobi, Kenya.",
    path: "/contact/",
  }),
};

export default function ContactPage() {
  return (
    <>
      <div className="border-b border-line bg-surface">
        <Container className="py-12 sm:py-16">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-accent">
            Contact
          </p>
          <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            One number for orders, prices and advice
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            Call it or message it on WhatsApp — it is the same line. Send your list and we will
            come back to you with prices and what is in stock.
          </p>
        </Container>
      </div>

      <Section>
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          {/* Contact details */}
          <div className="space-y-4">
            <Card>
              <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted">
                Phone
              </h2>
              <a
                href={telHref}
                className="mt-2 inline-flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink hover:text-accent"
              >
                <PhoneIcon className="h-5 w-5" />
                {BUSINESS.phoneDisplay}
              </a>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Best for a quick question about stock or a price you need now.
              </p>
            </Card>

            <Card>
              <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted">
                WhatsApp
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                The same number. Best for sending a list, a photo of what you bought last time,
                or a recipe you want priced.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={WA_GENERAL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-leaf-strong px-4 py-2.5 text-sm font-bold text-white hover:brightness-95"
                >
                  <WhatsAppIcon />
                  Start a chat
                </a>
                <a
                  href={WA_PRICE_LIST}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-bold text-ink hover:bg-surface-2"
                >
                  Ask for the price list
                </a>
              </div>
            </Card>

            <Card>
              <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted">
                Where to find us
              </h2>
              <p className="mt-2 text-base font-extrabold">
                {BUSINESS.city}, {BUSINESS.country}
              </p>
              {/* Not guessed. A wrong address sends a customer across Nairobi for nothing. */}
              <p className="mt-2 text-sm text-muted">
                <ToConfirm>
                  Street address and directions — to be supplied by Riziki before launch
                </ToConfirm>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Call ahead and we will direct you to the shop, and have your order weighed out
                by the time you arrive.
              </p>
            </Card>

            <Card>
              <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted">
                Opening hours
              </h2>
              <p className="mt-2 text-sm text-muted">
                <ToConfirm>
                  Opening hours — placeholder, to be confirmed by Riziki
                </ToConfirm>
              </p>
              <dl className="mt-3 space-y-1 text-sm text-muted">
                <div className="flex justify-between gap-4">
                  <dt>Monday – Friday</dt>
                  <dd className="font-semibold">To be confirmed</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Saturday</dt>
                  <dd className="font-semibold">To be confirmed</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Sunday &amp; public holidays</dt>
                  <dd className="font-semibold">To be confirmed</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Until these are confirmed, please call before travelling.
              </p>
            </Card>
          </div>

          {/* Enquiry form */}
          <div>
            <EnquiryForm />
          </div>
        </div>
      </Section>

      <Section tone="surface">
        <div className="max-w-3xl">
          <h2 className="text-xl font-extrabold tracking-tight">
            What to tell us when you get in touch
          </h2>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted">
            <li className="rounded-xl border border-line bg-page p-4">
              <strong className="text-ink">The product you are making</strong> — if you know the
              recipe, that is even better. It saves us both guessing at chemical names.
            </li>
            <li className="rounded-xl border border-line bg-page p-4">
              <strong className="text-ink">How much you want to make</strong> — batch size
              decides the pack sizes we quote you.
            </li>
            <li className="rounded-xl border border-line bg-page p-4">
              <strong className="text-ink">Whether it is for resale</strong> — bulk pricing and
              pack choices are different if you are filling your own bottles.
            </li>
            <li className="rounded-xl border border-line bg-page p-4">
              <strong className="text-ink">When you need it</strong> — so we can tell you
              straight away whether it is on the shelf.
            </li>
          </ul>
        </div>
      </Section>
    </>
  );
}

import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata = {
  title: "Privacy Policy",
  description: "How TallyPay collects, uses and protects your data.",
};

const UPDATED = "July 2026";

export default function PrivacyPage() {
  return (
    <div className="theme-light min-h-screen bg-white text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Brand href="/" />
          <Link href="/" className="text-sm font-semibold text-brand-700 hover:underline">
            ← Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-extrabold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted">Last updated: {UPDATED}</p>

        <div className="prose-tp mt-8 space-y-6 text-[15px] leading-relaxed text-ink">
          <p>
            TallyPay (“we”, “us”) is an invoicing and payments platform for businesses in Kenya,
            operated by SMP Developers Ltd. This policy explains what information we collect, how we
            use it, and the choices you have. By using TallyPay you agree to this policy.
          </p>

          <Section title="Information we collect">
            <ul>
              <li><b>Account details</b> — your name, email address and password (stored hashed).</li>
              <li><b>Business profile</b> — your business name, KRA PIN, address, phone, logo, bank details and branding you enter for your documents.</li>
              <li><b>Your records</b> — clients, items, quotations, invoices, receipts, delivery notes, credit notes and expenses you create.</li>
              <li><b>Payment information</b> — when you enable M‑Pesa, we store your payment provider (Kopo Kopo) configuration; provider secrets are encrypted. Payment confirmations we receive include a transaction reference and amount.</li>
              <li><b>Technical data</b> — basic logs (e.g. IP address, device/browser type) needed to operate and secure the service.</li>
            </ul>
          </Section>

          <Section title="How we use it">
            <ul>
              <li>To provide the service — create and share your documents, record payments, and show your reports.</li>
              <li>To process M‑Pesa payments made against your invoices, via your payment provider.</li>
              <li>To secure your account and prevent misuse.</li>
              <li>To contact you about your account or important service changes.</li>
            </ul>
          </Section>

          <Section title="Sharing">
            <p>We do not sell your data. We share it only with service providers that help us run TallyPay, and only as needed:</p>
            <ul>
              <li><b>Cloudflare</b> — hosting and database.</li>
              <li><b>Kopo Kopo</b> — M‑Pesa payment processing (only if you enable it).</li>
              <li><b>Resend</b> — sending emails you choose to send (e.g. an invoice to a client).</li>
            </ul>
            <p>Documents you share via a public link are visible to anyone who has that link.</p>
          </Section>

          <Section title="Data retention">
            <p>We keep your data for as long as your account is active. You can delete records in‑app, and you may request deletion of your account and its data by contacting us.</p>
          </Section>

          <Section title="Security">
            <p>Data is transmitted over HTTPS. Passwords are hashed and payment‑provider secrets are encrypted at rest. No system is perfectly secure, but we take reasonable measures to protect your information.</p>
          </Section>

          <Section title="Your rights">
            <p>You can access, correct or delete your information from within the app, or by contacting us. You may also request a copy of your data or ask us to delete your account.</p>
          </Section>

          <Section title="Children">
            <p>TallyPay is intended for businesses and is not directed to children under 18.</p>
          </Section>

          <Section title="Changes">
            <p>We may update this policy from time to time. Material changes will be reflected by the “Last updated” date above.</p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy or your data? Email{" "}
              <a className="font-semibold text-brand-700 underline" href="mailto:support@tallypay.co.ke">
                support@tallypay.co.ke
              </a>
              .
            </p>
          </Section>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-3xl px-6 py-6 text-center text-xs text-muted">
          Designed by <span className="font-semibold text-ink">SMP Developers Ltd</span>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <div className="space-y-2 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1 text-muted">{children}</div>
    </section>
  );
}

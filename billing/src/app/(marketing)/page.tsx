import Link from "next/link";
import { Brand, APP_NAME } from "@/components/brand";

const features = [
  { title: "Quotations → Invoices", body: "Send a quote, win the job, convert it to an invoice in one click." },
  { title: "Deposits & balances", body: "Bill a downpayment, track the balance, and never lose sight of what's owed." },
  { title: "Receipts, automatically", body: "Every payment becomes a numbered receipt you can share instantly." },
  { title: "Delivery notes", body: "Confirm what you delivered, standalone or linked to an invoice." },
  { title: "VAT & KRA PIN ready", body: "16% VAT, KRA PIN on every document — built for Kenya from day one." },
  { title: "Money dashboard", body: "Invoiced, paid, outstanding and overdue — at a glance." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Brand />
        <nav className="flex items-center gap-3">
          <Link href="/login" className="btn-ghost btn-sm">
            Sign in
          </Link>
          <Link href="/signup" className="btn-primary btn-sm">
            Get started
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-10 sm:pt-20">
        <div className="max-w-2xl">
          <span className="badge bg-brand-50 text-brand-700">For freelancers &amp; small businesses</span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            Get paid, without the paperwork.
          </h1>
          <p className="mt-4 text-lg text-muted">
            {APP_NAME} runs your whole billing cycle — quotation, invoice, deposit, balance, receipt
            and delivery note — with reports that actually add up. Built for Kenya (VAT &amp; KRA
            PIN), simple enough to use in minutes.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="btn-primary">
              Create your free workspace
            </Link>
            <Link href="/login" className="btn-ghost">
              I already have an account
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card p-5">
              <h3 className="font-semibold text-ink">{f.title}</h3>
              <p className="mt-1 text-sm text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-muted">
          © {new Date().getFullYear()} {APP_NAME}. Multi-vendor billing platform.
        </div>
      </footer>
    </div>
  );
}

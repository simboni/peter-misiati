import Link from "next/link";
import { Brand, BrandMark, APP_NAME } from "@/components/brand";

const features = [
  { t: "Quotations → Invoices", d: "Send a quote, win the job, convert it to an invoice in one click.", icon: "M4 7h16M4 12h10M4 17h7" },
  { t: "Deposits & balances", d: "Bill a downpayment, track the balance, and never lose sight of what's owed.", icon: "M12 3v18M5 8h9a3 3 0 010 6H7" },
  { t: "Receipts, automatically", d: "Every payment becomes a numbered receipt you can share instantly.", icon: "M5 4h14v16l-3-2-2 2-2-2-2 2-3-2zM8 9h8M8 13h5" },
  { t: "M-Pesa built in", d: "Clients pay by STK push from the invoice link; the receipt writes itself.", icon: "M7 4h10v16H7zM10 18h4" },
  { t: "VAT & KRA PIN ready", d: "16% VAT and KRA PIN on every document — built for Kenya from day one.", icon: "M9 12l2 2 4-4M12 3l7 4v5a9 9 0 01-7 8 9 9 0 01-7-8V7z" },
  { t: "Money dashboard", d: "Invoiced, paid, outstanding and overdue — all at a glance.", icon: "M4 19V5m0 14h16M8 15l3-4 3 2 4-6" },
];

const steps = [
  { n: "01", t: "Send a quote or invoice", d: "Add line items, a deposit and 16% VAT. Totals compute as you type." },
  { n: "02", t: "Get paid by M-Pesa", d: "The client taps “Pay”, approves the STK prompt — money lands, receipt issued." },
  { n: "03", t: "Track every shilling", d: "Balances update themselves; the dashboard shows what's owed and overdue." },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d={d} />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-ink">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Brand />
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="btn-ghost btn-sm">Sign in</Link>
            <Link href="/signup" className="btn-primary btn-sm">Get started</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(60rem 40rem at 75% -10%, #d1fae5 0%, rgba(209,250,229,0) 55%), radial-gradient(50rem 30rem at 5% 10%, #ecfdf5 0%, rgba(236,253,245,0) 60%)",
            }}
          />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-24 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> Built for Kenya · VAT &amp; KRA PIN
              </span>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
                Get paid,{" "}
                <span className="bg-gradient-to-r from-brand-700 to-brand-500 bg-clip-text text-transparent">
                  without the paperwork.
                </span>
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
                {APP_NAME} runs your whole billing cycle — quotation, invoice, deposit, balance and
                receipt — with <span className="font-semibold text-ink">M-Pesa payments built in</span>.
                Simple enough to use in minutes, free to start.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/signup" className="btn-primary px-6 py-3 text-base shadow-sm">
                  Create your free workspace
                </Link>
                <Link href="/login" className="btn-ghost px-6 py-3 text-base">
                  I already have an account
                </Link>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
                <span className="inline-flex items-center gap-1.5"><Check /> No card required</span>
                <span className="inline-flex items-center gap-1.5"><Check /> Free forever plan</span>
                <span className="inline-flex items-center gap-1.5"><Check /> Ready in minutes</span>
              </div>
            </div>

            {/* Product visual: floating invoice */}
            <div className="relative mx-auto w-full max-w-md lg:mx-0">
              <div className="absolute -right-3 -top-3 z-10 rotate-3 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white shadow-lg">
                Paid ✓
              </div>
              <div className="rounded-2xl border border-line bg-white p-6 shadow-[0_20px_60px_-20px_rgba(2,44,34,0.35)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BrandMark size={30} />
                    <div>
                      <p className="text-sm font-bold leading-none">Peter Studio</p>
                      <p className="text-[11px] text-muted">KRA PIN A012345678Z</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Invoice</p>
                    <p className="text-xs text-muted">INV-0001</p>
                  </div>
                </div>
                <div className="mt-5 space-y-2.5 border-t border-line pt-4 text-sm">
                  <Row label="Website design &amp; build" value="KES 80,000" />
                  <Row label="Brand identity" value="KES 24,000" />
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>VAT (16%)</span><span className="tabular-nums">KES 16,640</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                  <span className="text-sm font-semibold">Total</span>
                  <span className="text-lg font-extrabold text-brand-700 tabular-nums">KES 120,640</span>
                </div>
                <button className="mt-5 w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white">
                  Pay with M-Pesa
                </button>
                <p className="mt-2 text-center text-[11px] text-muted">Powered by TallyPay</p>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Everything the sale needs</h2>
            <p className="mt-3 text-lg text-muted">One tidy workflow from first quote to final receipt — nothing to stitch together.</p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.t} className="group rounded-2xl border border-line bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                  <Icon d={f.icon} />
                </div>
                <h3 className="mt-4 font-bold">{f.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="border-y border-line bg-canvas">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Live in three steps</h2>
              <p className="mt-3 text-lg text-muted">Sign up and you're invoicing today — no setup, no accountant required.</p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {steps.map((s) => (
                <div key={s.n} className="relative rounded-2xl border border-line bg-white p-6">
                  <span className="font-mono text-3xl font-extrabold text-brand-200">{s.n}</span>
                  <h3 className="mt-2 text-lg font-bold">{s.t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* AI feature spotlight */}
        <section className="mx-auto max-w-6xl px-6 pb-4 pt-8">
          <div className="relative overflow-hidden rounded-3xl border border-brand-200 bg-brand-50/60 p-8 sm:p-12">
            <div className="grid items-center gap-8 lg:grid-cols-2">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-700 ring-1 ring-brand-200">
                  ✨ Pro · Coming soon
                </span>
                <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                  Create invoices with <span className="text-brand-700">AI</span>
                </h2>
                <p className="mt-3 max-w-md text-lg text-muted">
                  Type the job in plain language and TallyPay drafts the whole invoice — line items,
                  VAT and totals — ready to review and send. Invoicing in seconds, not minutes.
                </p>
                <Link href="/signup" className="btn-primary mt-6 inline-flex px-6 py-3">Get on Pro early</Link>
              </div>
              {/* Prompt → invoice mock */}
              <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
                <div className="rounded-xl bg-canvas px-4 py-3 text-sm text-ink">
                  <span className="text-muted">You:</span> “Website design + 1yr hosting for Acme Ltd, 50% deposit”
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-brand-700">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" /> TallyPay drafted your invoice
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between"><span>Website design &amp; build</span><span className="tabular-nums">KES 80,000</span></div>
                  <div className="flex justify-between"><span>1-year hosting</span><span className="tabular-nums">KES 24,000</span></div>
                  <div className="flex justify-between text-muted"><span>VAT (16%)</span><span className="tabular-nums">KES 16,640</span></div>
                  <div className="flex justify-between border-t border-line pt-2 font-bold"><span>Total</span><span className="tabular-nums text-brand-700">KES 120,640</span></div>
                  <div className="flex justify-between text-xs text-muted"><span>Deposit due (50%)</span><span className="tabular-nums">KES 60,320</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Free to start. Yours when you grow.</h2>
            <p className="mt-3 text-lg text-muted">Run your whole business free. Upgrade to make it fully your own brand.</p>
          </div>
          <div className="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-line bg-white p-7">
              <p className="text-sm font-semibold uppercase tracking-wide text-muted">Free</p>
              <p className="mt-2 text-4xl font-extrabold">KES 0<span className="text-base font-medium text-muted"> / forever</span></p>
              <ul className="mt-6 space-y-3 text-sm">
                <Li>Unlimited invoices, quotes &amp; receipts</Li>
                <Li>M-Pesa payment collection</Li>
                <Li>Clients, items &amp; money dashboard</Li>
                <Li>VAT 16% &amp; KRA PIN documents</Li>
              </ul>
              <Link href="/signup" className="btn-ghost mt-7 w-full py-3">Start free</Link>
            </div>
            <div className="relative rounded-2xl border-2 border-brand-500 bg-white p-7 shadow-[0_20px_60px_-24px_rgba(5,150,105,0.5)]">
              <span className="absolute -top-3 left-7 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white">White-label</span>
              <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">Pro</p>
              <p className="mt-2 text-4xl font-extrabold">KES 1,000<span className="text-base font-medium text-muted"> / user / mo</span></p>
              <ul className="mt-6 space-y-3 text-sm">
                <Li>Everything in Free, plus…</Li>
                <Li><b>AI invoice creation</b> — describe it, done <span className="ml-1 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">Soon</span></Li>
                <Li>Your own logo on every document</Li>
                <Li>5 invoice templates &amp; brand colours</Li>
                <Li>Remove the “Powered by TallyPay” mark</Li>
              </ul>
              <Link href="/signup" className="btn-primary mt-7 w-full py-3">Get started</Link>
            </div>
          </div>
        </section>

        {/* CTA band */}
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-8 py-14 text-center text-white sm:px-16">
            <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-black/10" />
            <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">Start getting paid today</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-brand-50">
              Create your free workspace, send your first invoice, and collect by M-Pesa — in the next five minutes.
            </p>
            <Link href="/signup" className="relative mt-8 inline-flex rounded-xl bg-white px-7 py-3.5 text-base font-bold text-brand-700 shadow-sm transition-transform hover:scale-[1.02]">
              Create your free workspace →
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted sm:flex-row">
          <div className="flex items-center gap-2">
            <BrandMark size={22} />
            <span>© {new Date().getFullYear()} {APP_NAME}. Multi-vendor billing for Kenya.</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/login" className="hover:text-ink">Sign in</Link>
            <Link href="/signup" className="hover:text-ink">Get started</Link>
          </div>
        </div>
        <div className="border-t border-line py-4 text-center text-xs text-muted">
          Designed by{" "}
          <span className="font-semibold text-ink">SMP Developers Ltd</span>
        </div>
      </footer>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink">{label}</span>
      <span className="font-medium tabular-nums text-ink">{value}</span>
    </div>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-brand-600">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 text-brand-600"><Check /></span>
      <span className="text-ink">{children}</span>
    </li>
  );
}

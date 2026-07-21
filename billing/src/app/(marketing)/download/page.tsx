import Link from "next/link";
import { Brand } from "@/components/brand";
import { ANDROID_APK_URL } from "@/lib/flags";

export const metadata = {
  title: "Download the app",
  description: "Install TallyPay for Android — invoices, receipts and M-Pesa payments on your phone.",
};

export default function DownloadPage() {
  return (
    <div className="theme-light flex min-h-screen flex-col bg-white text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Brand href="/" />
          <Link href="/" className="text-sm font-semibold text-brand-700 hover:underline">
            ← Back
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-6 py-14 text-center">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80"
          style={{ background: "radial-gradient(50rem 22rem at 50% -20%, #d1fae5 0%, rgba(209,250,229,0) 60%)" }}
        />
        <div className="grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 text-3xl font-extrabold text-white shadow-[0_18px_40px_-16px_rgba(4,120,87,0.6)]">
          T
        </div>
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight sm:text-4xl">Get TallyPay for Android</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Invoices, receipts, delivery notes and M-Pesa payments — on your phone. The app opens the
          same account you use on the web and updates itself automatically.
        </p>

        <a
          href={ANDROID_APK_URL}
          className="btn-primary mt-8 inline-flex items-center gap-2 px-7 py-3.5 text-base shadow-sm"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12m0 0l4-4m-4 4l-4-4M5 21h14" />
          </svg>
          Download for Android
        </a>
        <p className="mt-3 text-xs text-muted">Free · ~5 MB · Android 8.0+</p>

        <div className="mt-12 w-full max-w-md rounded-2xl border border-line bg-brand-50/40 p-6 text-left">
          <h2 className="text-sm font-bold uppercase tracking-wide text-brand-700">How to install</h2>
          <ol className="mt-3 space-y-2 text-sm text-ink [&_li]:ml-5 [&_li]:list-decimal">
            <li>Tap <b>Download for Android</b> above (on your phone).</li>
            <li>Open the downloaded <b>tallypay.apk</b> file.</li>
            <li>If Android warns you, tap <b>Settings → allow from this source</b>, then <b>Install</b>.</li>
            <li>Open TallyPay and sign in — you're set.</li>
          </ol>
          <p className="mt-4 text-xs text-muted">
            Installing outside Google Play is safe here — the app is our own, and a Google Play
            listing is on the way. On iPhone, open <b>tallypay.co.ke</b> in Safari →{" "}
            <b>Share → Add to Home Screen</b>.
          </p>
        </div>

        <Link href="/signup" className="mt-10 text-sm font-semibold text-brand-700 hover:underline">
          Don't have an account yet? Create one free →
        </Link>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-3xl px-6 py-6 text-center text-xs text-muted">
          Designed by <span className="font-semibold text-ink">SMP Developers Ltd</span>
        </div>
      </footer>
    </div>
  );
}

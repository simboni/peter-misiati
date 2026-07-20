import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata = {
  title: "Delete your account",
  description: "How to delete your TallyPay account and what data is removed.",
};

export default function DeleteAccountPage() {
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
        <h1 className="text-3xl font-extrabold tracking-tight">Delete your account</h1>
        <p className="mt-2 text-sm text-muted">
          TallyPay by SMP Developers Ltd · app <b>ke.co.tallypay.app</b>
        </p>

        <div className="prose-tp mt-8 space-y-6 text-[15px] leading-relaxed text-ink">
          <p>
            You can permanently delete your TallyPay account and all associated data at any time.
            There are two ways to do it.
          </p>

          <Section title="Delete it yourself, in the app (fastest)">
            <ol>
              <li>Open TallyPay and sign in.</li>
              <li>
                Go to <b>Settings</b> (the <b>More</b> tab on mobile, then <b>Settings</b>).
              </li>
              <li>
                Scroll to <b>Delete account</b>, tap <b>Delete my account</b>, type{" "}
                <b>DELETE MY ACCOUNT</b> to confirm, and tap <b>Permanently delete account</b>.
              </li>
            </ol>
            <p>
              Your account is deleted immediately and you are signed out. This cannot be undone.
            </p>
          </Section>

          <Section title="Or request deletion by email">
            <p>
              Email{" "}
              <a className="font-semibold text-brand-700 underline" href="mailto:support@tallypay.co.ke?subject=Delete%20my%20account">
                support@tallypay.co.ke
              </a>{" "}
              from the email address on your account, with the subject “Delete my account”. We will
              verify it’s you and delete your account within 30 days, then confirm by email.
            </p>
          </Section>

          <Section title="What gets deleted">
            <p>When you delete your account, we permanently remove:</p>
            <ul>
              <li>Your login and profile — name, email and password.</li>
              <li>Your device push‑notification tokens.</li>
              <li>Your sessions and connected sign‑in methods.</li>
            </ul>
            <p>
              If you <b>own a workspace</b>, deleting your account also permanently deletes that
              workspace and everything in it — your business profile and KRA PIN, clients, items,
              quotations, invoices, receipts, delivery notes, credit notes, expenses, payment
              records and payment‑provider settings. If you are only a member of someone else’s
              workspace, you are removed from it and the workspace is kept.
            </p>
          </Section>

          <Section title="What is kept, and for how long">
            <p>
              Deletion is immediate and irreversible; we do not retain a copy of your records after
              deletion. We may keep minimal transaction logs required by law or to prevent fraud
              (for example, a record that a payment occurred) for as long as the law requires, with
              no personal profile attached. Documents you previously shared by public link stop
              working once deleted.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Any questions about deletion or your data? Email{" "}
              <a className="font-semibold text-brand-700 underline" href="mailto:support@tallypay.co.ke">
                support@tallypay.co.ke
              </a>
              . See also our{" "}
              <Link className="font-semibold text-brand-700 underline" href="/privacy">
                Privacy Policy
              </Link>
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
      <div className="space-y-2 [&_li]:ml-5 [&_li]:list-disc [&_ol]:list-decimal [&_ol]:space-y-1 [&_ul]:space-y-1 text-muted">
        {children}
      </div>
    </section>
  );
}

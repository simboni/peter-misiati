import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, requireUser } from "@/lib/auth";
import { getPrintSettings, savePrintSettings } from "@/lib/print-settings";
import { PageTitle, SectionLabel } from "@/components/ui";
import { PrinterSettingsForm, type PrinterFormState } from "@/components/thermal-print";

export const dynamic = "force-dynamic";

/**
 * Printer setup: pair the till printer, say how wide the paper is, set what
 * prints above and below the sale, and prove it with a test receipt.
 *
 * The pairing itself can only happen in the browser, so everything below the
 * fold is the client component — this page just supplies the saved settings and
 * the action to write them back.
 */
export default async function PrinterSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const settings = getPrintSettings();

  /**
   * `requireUser()` first, always: a Server Action is reachable by a plain POST,
   * not only through the form we rendered — the `currentUser()` check above
   * guards the page, not the action. Pairing a printer is counter work rather
   * than owner work, so staff are allowed; nothing here touches cost or formula
   * data.
   */
  async function savePrinterSettingsAction(
    _prev: PrinterFormState,
    formData: FormData,
  ): Promise<PrinterFormState> {
    "use server";
    const actor = await requireUser();

    try {
      savePrintSettings(
        {
          paper: String(formData.get("paper") ?? ""),
          header: String(formData.get("header") ?? ""),
          footer: String(formData.get("footer") ?? ""),
          autoPrint: formData.get("auto_print") != null,
        },
        actor.id,
      );
      return { ok: "Saved. Every receipt from now on prints this way." };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not save. Try again." };
    }
  }

  return (
    <div>
      <PageTitle
        title="Receipt printer"
        subtitle="The Bluetooth till printer at the counter. Paper receipts (A5) are unaffected."
      />

      <PrinterSettingsForm settings={settings} action={savePrinterSettingsAction} />

      <SectionLabel>If it will not print</SectionLabel>
      <ul className="space-y-2 rounded-2xl border border-line bg-white p-4 text-sm text-muted">
        <li>
          <span className="font-semibold text-ink">Use Chrome on Android.</span> Web Bluetooth does not
          exist in Safari, Firefox, or any browser on an iPhone.
        </li>
        <li>
          <span className="font-semibold text-ink">The page must be secure.</span> Chrome only allows
          Bluetooth on https, or on <span className="font-mono">http://localhost</span> when the app runs on
          the phone itself. A plain <span className="font-mono">http://192.168…</span> address will be
          refused.
        </li>
        <li>
          <span className="font-semibold text-ink">Pick the printer, not the pairing.</span> Choose the
          device whose name matches the printer (often <span className="font-mono">Printer001</span> or{" "}
          <span className="font-mono">BlueTooth Printer</span>) rather than anything already paired in
          Android&rsquo;s own Bluetooth settings.
        </li>
        <li>
          <span className="font-semibold text-ink">Characters look wrong?</span> Set the printer&rsquo;s own
          code page to CP437 or CP850 in its self-test menu.
        </li>
      </ul>

      <div className="mt-4 text-sm font-bold text-brand">
        <Link href="/settings">← Users &amp; settings</Link>
      </div>
    </div>
  );
}

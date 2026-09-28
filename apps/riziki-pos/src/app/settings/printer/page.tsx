import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, requireUser } from "@/lib/auth";
import { getPrintSettings, savePrintSettings } from "@/lib/print-settings";
import { PageTitle, SectionLabel } from "@/components/ui";
import { PrinterSettingsForm, PrinterPicker, type PrinterFormState } from "@/components/thermal-print";
import { markSrc } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * Printer setup: connect the till printer, say how wide the paper is, set what
 * prints above and below the sale, and prove it with a test receipt.
 *
 * The connecting itself can only happen in the browser — and what is possible
 * depends on the machine the page is open on, which the server cannot know — so
 * everything below the fold is the client component. This page just supplies the
 * saved settings and the action to write them back.
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
          showDiscounts: formData.get("show_discounts") != null,
          logo: formData.get("logo") != null,
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
        subtitle="The till printer at the counter, over Bluetooth or on a cable. Paper receipts (A5) are unaffected."
      />

      {/*
        The printer itself first, the paper it prints on second.

        Pairing used to happen only as a side effect of tapping Print at the
        counter, and changing printers was offered only after a failure — so the
        one screen named after the printer had no way to name one.
      */}
      <PrinterPicker paper={settings.paper} header={settings.header} footer={settings.footer} />

      <div className="mt-4">
        <PrinterSettingsForm
          settings={{ ...settings, logoSrc: markSrc() }}
          action={savePrinterSettingsAction}
        />
      </div>

      <SectionLabel>If it will not print</SectionLabel>
      <ul className="space-y-2 rounded-2xl border border-line bg-white p-4 text-sm text-muted">
        <li>
          <span className="font-semibold text-ink">On a computer, use the cable.</span> A computer
          cannot reach these printers over Bluetooth, however well they pair in Windows. A browser
          speaks only Bluetooth Low Energy and the printer is an older Bluetooth Classic machine, so
          the app finds it, accepts it, and then has nothing to print on — which looks exactly like it
          choosing the printer and letting it go again. Plug the USB lead in and use Connect by cable.
        </li>
        <li>
          <span className="font-semibold text-ink">On the counter phone, use Bluetooth.</span> Chrome
          on Android. Web Bluetooth does not exist in Safari, Firefox, or any browser on an iPhone.
        </li>
        <li>
          <span className="font-semibold text-ink">Pick the printer, not the pairing.</span> On a
          phone these machines usually show up twice — the same printer, listed once for its old
          Bluetooth and once for the kind a browser can use. Choose the one whose name matches the
          printer (often <span className="font-mono">Printer001</span> or{" "}
          <span className="font-mono">BlueTooth Printer</span>). If the first one pairs and then says
          it offers nothing to print on, tap Print again and take the other.
        </li>
        <li>
          <span className="font-semibold text-ink">The page must be secure.</span> Neither Bluetooth
          nor a cable is offered on plain http. Use https, or{" "}
          <span className="font-mono">http://localhost</span> when the app runs on the machine itself.
          A plain <span className="font-mono">http://192.168…</span> address will be refused.
        </li>
        <li>
          <span className="font-semibold text-ink">No port in the cable list?</span> The computer
          needs the driver for the printer’s USB chip — CH340 or Prolific on most of these machines.
          Install it, unplug the printer and plug it back in, then try again.
        </li>
        <li>
          <span className="font-semibold text-ink">Rubbish coming out on the cable?</span> That is the
          speed, not the printer. Hold the feed button down while switching the printer on: it prints
          its own settings, speed included. Set the same number in Speed above.
        </li>
        <li>
          <span className="font-semibold text-ink">Characters look wrong?</span> Set the printer’s own
          code page to CP437 or CP850 in its self-test menu.
        </li>
      </ul>

      <div className="mt-4 text-sm font-bold text-brand">
        <Link href="/settings">← Users & settings</Link>
      </div>
    </div>
  );
}

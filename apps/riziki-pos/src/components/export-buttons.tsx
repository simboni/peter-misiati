"use client";

/**
 * Take this report away — as a PDF, or as a spreadsheet.
 *
 * Two icons rather than a "Print" button, because printing is the mechanism and
 * not the errand. Nobody opens a report meaning to print it; they mean to send
 * last month's figures to the bank, or hand the accountant something they can
 * add up. So the buttons are named after what comes out — PDF, Excel — and the
 * printer is an implementation detail behind one of them.
 *
 * The PDF is the browser's own print dialog with "Save as PDF" chosen. That is
 * a real limitation and it is worth being honest about why it is the right one
 * anyway: the page on screen IS the document, laid out by the same stylesheet,
 * so what comes out cannot disagree with what was read. A server-rendered PDF
 * of a report would be a second renderer of the same figures, and a second
 * renderer is a second thing that can be wrong. The print stylesheet already
 * drops the navigation, the buttons and this bar.
 *
 * The spreadsheet is CSV. Excel, Sheets and every accounting package open it,
 * it streams so it survives a bad connection, and it needs no library in the
 * app to write — a real .xlsx is a zip of XML this app has no business
 * generating by hand.
 *
 * Sized as proper touch targets with the word beside the glyph. An icon alone
 * is a guess, and the two guesses here would be "print" and "download", which
 * are not the same as "PDF" and "Excel".
 */

const CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-[13px] font-bold ring-1 ring-inset transition-colors xl:min-h-10";

function PdfGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 14h1.5a1.5 1.5 0 0 1 0 3H9v-3zM14 14h2M14 17v-3" />
    </svg>
  );
}

function SheetGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10M15 10v10" />
    </svg>
  );
}

export function ExportButtons({
  /** The CSV this report corresponds to, e.g. "sales". Omitted where none fits. */
  csv,
  /** What the file should be called when it lands, minus the extension. */
  label,
}: {
  csv?: string;
  label: string;
}) {
  return (
    <div className="no-print flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => window.print()}
        title={`Save ${label} as a PDF, or send it to the printer`}
        className={`${CHIP} bg-white text-bad ring-line hover:bg-bad-soft`}
      >
        <PdfGlyph />
        PDF
      </button>

      {csv ? (
        <a
          // A plain anchor, not next/link: this is a file download, and a
          // prefetched link would quietly export the whole table every time the
          // page was looked at.
          href={`/export?table=${csv}`}
          title={`Download ${label} as a spreadsheet — opens in Excel or Sheets`}
          className={`${CHIP} bg-white text-good ring-line hover:bg-good-soft`}
        >
          <SheetGlyph />
          Excel
        </a>
      ) : null}
    </div>
  );
}

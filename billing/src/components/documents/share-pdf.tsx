"use client";

import { useState } from "react";
import type { PdfDocInput } from "@/lib/invoice-pdf";

/**
 * Build a clean, vector A4 PDF of the document (real selectable text, laid out
 * for print — NOT a screenshot of the page) and share it as a file via the
 * device share sheet, falling back to a download where file-sharing isn't
 * supported. `doc` carries the structured data; the heavy jspdf builder is
 * dynamically imported so it only loads on click.
 */
export function SharePdf({ doc, fileBase, docLabel }: { doc: PdfDocInput; fileBase: string; docLabel: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function onShare() {
    setBusy(true);
    setErr(false);
    try {
      const { buildDocumentPdf } = await import("@/lib/invoice-pdf");
      const bytes = await buildDocumentPdf(doc);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const fileName = `${fileBase}.pdf`;
      const file = new File([blob], fileName, { type: "application/pdf" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: docLabel });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user cancelled the share sheet
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={onShare} disabled={busy} className="btn-primary btn-sm" title="Download a print-ready PDF">
      {busy ? "Preparing PDF…" : err ? "Retry PDF" : "Share PDF"}
    </button>
  );
}

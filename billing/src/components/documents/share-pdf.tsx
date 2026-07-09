"use client";

import { useState } from "react";

/**
 * Build a PDF of the on-page document (client-side, no server) and share it as
 * an actual file via the device's share sheet — so WhatsApp/Email/etc. receive
 * a PDF, not a link. Falls back to downloading the PDF where file-sharing isn't
 * supported (most desktops).
 */
export function SharePdf({ fileBase, docLabel }: { fileBase: string; docLabel: string }) {
  const [busy, setBusy] = useState(false);

  async function makePdfBlob(): Promise<Blob> {
    const el = document.getElementById("tp-doc");
    if (!el) throw new Error("Document not found on the page.");
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      allowTaint: true,
      logging: false,
    });
    const img = canvas.toDataURL("image/jpeg", 0.92);

    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * pageW) / canvas.width;

    if (imgH <= pageH) {
      pdf.addImage(img, "JPEG", 0, 0, imgW, imgH);
    } else {
      // Taller than one page — tile the same image up the pages.
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(img, "JPEG", 0, position, imgW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position -= pageH;
        pdf.addPage();
        pdf.addImage(img, "JPEG", 0, position, imgW, imgH);
        heightLeft -= pageH;
      }
    }
    return pdf.output("blob");
  }

  async function onShare() {
    setBusy(true);
    try {
      const blob = await makePdfBlob();
      const fileName = `${fileBase}.pdf`;
      const file = new File([blob], fileName, { type: "application/pdf" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: docLabel, text: docLabel });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      // User cancelled the share sheet — do nothing.
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Anything else (a browser that can't rasterize the page): fall back to
      // the native Save as PDF so the user still ends up with a PDF.
      try {
        window.print();
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={onShare} disabled={busy} className="btn-primary btn-sm">
      {busy ? "Preparing PDF…" : "Share PDF"}
    </button>
  );
}

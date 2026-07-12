"use client";

import { useEffect, useState } from "react";
import { SharePdf } from "./share-pdf";
import type { PdfDocInput } from "@/lib/invoice-pdf";

export function PrintBar({
  docLabel,
  clientEmail,
  clientPhone,
  pdfHref,
  fileBase,
  pdf,
}: {
  docLabel: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  pdfHref?: string | null;
  fileBase?: string;
  pdf?: PdfDocInput;
}) {
  const [copied, setCopied] = useState(false);
  // Set on the client after mount to avoid a hydration mismatch.
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(window.location.href), []);
  const message = `Hello, here is your ${docLabel}: ${url}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const wa = clientPhone
    ? `https://wa.me/${clientPhone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  const mail = `mailto:${clientEmail ?? ""}?subject=${encodeURIComponent(docLabel)}&body=${encodeURIComponent(message)}`;

  return (
    <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b border-line bg-white/90 px-4 py-3 backdrop-blur">
      {pdf && <SharePdf doc={pdf} fileBase={fileBase || docLabel.replace(/\s+/g, "-")} docLabel={docLabel} />}
      <button onClick={() => window.print()} className="btn-ghost btn-sm">
        Print / Save as PDF
      </button>
      {pdfHref && (
        <a href={pdfHref} className="btn-ghost btn-sm" target="_blank" rel="noreferrer">
          Download PDF
        </a>
      )}
      <button onClick={copy} className="btn-ghost btn-sm">
        {copied ? "Link copied ✓" : "Copy link"}
      </button>
      <a href={wa} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">
        WhatsApp
      </a>
      <a href={mail} className="btn-ghost btn-sm">
        Email
      </a>
    </div>
  );
}

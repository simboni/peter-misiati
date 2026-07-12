"use client";

import { useEffect, useState } from "react";

export function PrintBar({
  docLabel,
  clientEmail,
  clientPhone,
  pdfHref,
  shareUrl,
}: {
  docLabel: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  pdfHref?: string | null;
  /** Canonical link to share — the vendor's custom domain when configured. */
  shareUrl?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  // Prefer the server-provided canonical URL (vendor's custom domain); fall
  // back to the current address once mounted (avoids a hydration mismatch).
  const [url, setUrl] = useState(shareUrl ?? "");
  useEffect(() => {
    if (!shareUrl) setUrl(window.location.href);
  }, [shareUrl]);
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
      <button onClick={() => window.print()} className="btn-primary btn-sm">
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

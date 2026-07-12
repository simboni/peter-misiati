"use client";

import { useEffect, useState } from "react";

export function PrintBar({
  docLabel,
  clientEmail,
  clientPhone,
  pdfHref,
}: {
  docLabel: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  pdfHref?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  // Use the page's actual address — always the real production URL, regardless
  // of server env config. Set after mount to avoid a hydration mismatch.
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

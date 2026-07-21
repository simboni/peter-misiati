"use client";

import { useEffect, useState } from "react";
import { canShare, share } from "@/lib/native";

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
  // Whether to show the native/OS share button (in-app, or a browser that
  // supports Web Share). Resolved after mount so SSR markup stays stable.
  const [shareable, setShareable] = useState(false);
  useEffect(() => {
    setUrl(window.location.href);
    setShareable(canShare());
  }, []);
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

  const shareNative = async () => {
    const ok = await share({ title: docLabel, text: message, url });
    if (!ok) copy(); // no share sheet available — fall back to copying the link
  };

  const wa = clientPhone
    ? `https://wa.me/${clientPhone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  const mail = `mailto:${clientEmail ?? ""}?subject=${encodeURIComponent(docLabel)}&body=${encodeURIComponent(message)}`;

  return (
    <div className="doc-toolbar no-print sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b border-line bg-white/90 px-4 py-3 backdrop-blur">
      {/* WhatsApp is the primary way Kenyan businesses send documents — make it
          the big, obvious first action. */}
      <a
        href={wa}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2 text-sm font-bold text-white shadow-sm transition-transform active:scale-95"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.1h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.69 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.24.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43l-.48-.01c-.16 0-.43.06-.66.31-.22.24-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.16 1.75 2.67 4.25 3.74.59.26 1.06.41 1.42.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29Z" />
        </svg>
        Send on WhatsApp
      </a>
      <button onClick={() => window.print()} className="btn-primary btn-sm">
        Print / Save as PDF
      </button>
      {shareable && (
        <button onClick={shareNative} className="btn-ghost btn-sm">
          Share
        </button>
      )}
      {pdfHref && (
        <a href={pdfHref} className="btn-ghost btn-sm" target="_blank" rel="noreferrer">
          Download PDF
        </a>
      )}
      <button onClick={copy} className="btn-ghost btn-sm">
        {copied ? "Link copied ✓" : "Copy link"}
      </button>
      <a href={mail} className="btn-ghost btn-sm">
        Email
      </a>
    </div>
  );
}

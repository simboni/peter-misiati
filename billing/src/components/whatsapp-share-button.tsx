"use client";

import { useEffect, useState } from "react";

/**
 * One-tap WhatsApp share for a document. Builds a wa.me link to the public
 * share page, prefilled with a friendly message (and the client's number when
 * known, so it opens straight in their chat). The absolute URL is resolved from
 * the live page origin after mount, so it always points at the real domain.
 */
export function WhatsAppShareButton({
  path,
  label,
  phone,
  amountText,
  size = "md",
  full = false,
}: {
  path: string; // e.g. /d/<shareToken>
  label: string; // e.g. "Invoice INV-0006"
  phone?: string | null;
  amountText?: string | null;
  size?: "sm" | "md";
  full?: boolean;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const url = `${origin}${path}`;
  const message = `Hello, here is your ${label}${amountText ? ` for ${amountText}` : ""}: ${url}`;
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  const href = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;

  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-[#25D366] font-bold text-white shadow-sm transition-transform active:scale-95 ${pad} ${full ? "w-full" : ""}`}
    >
      <svg viewBox="0 0 24 24" className={size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]"} fill="currentColor" aria-hidden>
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.1h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.69 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.24.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43l-.48-.01c-.16 0-.43.06-.66.31-.22.24-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.16 1.75 2.67 4.25 3.74.59.26 1.06.41 1.42.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29Z" />
      </svg>
      Send on WhatsApp
    </a>
  );
}

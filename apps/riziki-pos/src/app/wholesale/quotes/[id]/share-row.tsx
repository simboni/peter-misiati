"use client";

import { useState } from "react";

/**
 * Getting the quote to the customer.
 *
 * Three routes, because the shop's customers are not one kind of person: a
 * hardware shop owner reads WhatsApp, a company buyer wants it in email for
 * their records, and somebody standing at the counter wants paper.
 *
 * WhatsApp is first and prefilled with the customer's stored number, because it
 * is how this shop actually trades — the website's every call to action already
 * points there. If no number is on file the button still works; it opens
 * WhatsApp with the message ready and asks who to send it to, which is better
 * than refusing until somebody edits the customer record.
 */
export default function ShareRow({
  phone,
  message,
  subject,
  printHref,
}: {
  phone: string;
  message: string;
  subject: string;
  printHref: string;
}) {
  const [copied, setCopied] = useState(false);

  // wa.me wants digits only. Kenyan numbers get written 0722…, +254722… and
  // 254722… interchangeably, so normalise rather than trust the record.
  const digits = phone.replace(/\D/g, "");
  const wa = digits
    ? `https://wa.me/${digits.startsWith("0") ? "254" + digits.slice(1) : digits}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  const mail = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (insecure origin, or an old WebView). The other three
      // routes still work, so this fails quietly rather than alarming anyone.
    }
  }

  const btn =
    "flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors xl:min-h-10";

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <a href={wa} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#25D366] text-white`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
          <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm5.8 14.2c-.2.7-1.2 1.3-1.9 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.7-.6-2.9-1.3-4.8-4.3-5-4.5-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.4.7-.4h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.5-.3.3c-.1.1-.3.3-.1.5.1.3.6 1.1 1.4 1.7 1 .8 1.7 1.1 2 1.2.2.1.4.1.5-.1l.7-.9c.2-.2.3-.2.6-.1l1.9.9c.3.1.4.2.5.3 0 .1 0 .6-.2 1.1z" />
        </svg>
        WhatsApp{digits ? "" : " — pick a number"}
      </a>

      <a href={mail} className={`${btn} bg-white text-brand-dark ring-1 ring-inset ring-line`}>
        Email
      </a>

      <a href={printHref} target="_blank" rel="noopener noreferrer" className={`${btn} bg-white text-brand-dark ring-1 ring-inset ring-line`}>
        Print / PDF
      </a>

      <button type="button" onClick={copy} className={`${btn} bg-white text-muted ring-1 ring-inset ring-line`}>
        {copied ? "Copied" : "Copy text"}
      </button>
    </div>
  );
}

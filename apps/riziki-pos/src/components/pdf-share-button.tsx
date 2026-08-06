"use client";

/**
 * Get a PDF out of the phone: to WhatsApp, to email, to Drive, or just saved.
 *
 * `wa.me` — the deep link the "Share on WhatsApp" button next to this one
 * opens — can only ever pre-fill a text message. There is no parameter that
 * attaches a file; that is a WhatsApp platform limit, not something this app
 * can route around. The one way to actually hand someone a *file* over
 * WhatsApp from a phone browser is the OS share sheet, which `navigator.share`
 * opens when it is given a `File` — so that is what this does when it can, and
 * falls back to an ordinary download everywhere it can't (desktop Chrome,
 * older phones): a real PDF either way, never nothing.
 */

import { useState } from "react";

export function PdfShareButton({
  href,
  fileName,
  shareTitle,
  shareText,
}: {
  /** The route that returns the PDF bytes, e.g. `/invoice/42/pdf`. */
  href: string;
  fileName: string;
  shareTitle: string;
  shareText?: string;
}) {
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setState("busy");
    setError(null);
    try {
      const res = await fetch(href, { cache: "no-store" });
      if (!res.ok) throw new Error(`the till answered ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: "application/pdf" });

      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
        share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
      };

      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: shareTitle, text: shareText });
        setState("idle");
        return;
      }

      // No file-sharing on this browser: fall back to a plain download. The
      // link is revoked right after the click is dispatched — the download
      // itself has already started reading the blob by then.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch (err) {
      setState("idle");
      // Cancelling the share sheet also throws (AbortError) — that is the
      // person changing their mind, not a fault, so it is the one case left
      // silent. Anything else — no network, the till refused — is said aloud.
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Could not get the PDF. Check the connection and try again.");
    }
  }

  return (
    <div className="flex-1">
      <button
        type="button"
        onClick={go}
        disabled={state === "busy"}
        className="w-full rounded-xl bg-brand-soft px-4 py-3 text-center text-sm font-bold text-brand-dark disabled:opacity-60"
      >
        {state === "busy" ? "Preparing…" : "PDF"}
      </button>
      {error ? <p className="mt-1.5 text-center text-[11px] font-semibold text-bad">{error}</p> : null}
    </div>
  );
}

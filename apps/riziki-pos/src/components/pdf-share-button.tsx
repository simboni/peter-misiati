"use client";

/**
 * Get a PDF out of the phone: to WhatsApp, to email, to Drive, or just saved.
 *
 * A `wa.me` deep link — the old "Share on WhatsApp" — can only ever pre-fill a
 * text message; there is no parameter that attaches a file, which is a
 * WhatsApp platform limit, not something this app can route around. The one
 * way to actually hand someone a *file* over WhatsApp from a phone browser is
 * the OS share sheet, which `navigator.share` opens when it is given a `File`
 * — WhatsApp is then just one of the apps listed there, exactly as if the PDF
 * had been shared from the Files app. That is what this does when the browser
 * supports it, and falls back to an ordinary download everywhere it can't
 * (desktop Chrome, older phones): a real PDF either way, never nothing.
 *
 * `source` is either a route to fetch the bytes from, or the bytes already in
 * hand. The second exists for one reason: a queued offline sale has no server
 * to fetch from — its PDF is built right there on the phone (see
 * `receiptFromQueued` in the Sell screen) — so this button must not assume a
 * network round trip is how a PDF always arrives.
 */

import { useState } from "react";

export type PdfSource = { href: string } | { bytes: Uint8Array };

export function PdfShareButton({
  source,
  fileName,
  shareTitle,
  shareText,
  label = "PDF",
  busyLabel = "Preparing…",
}: {
  source: PdfSource;
  fileName: string;
  shareTitle: string;
  shareText?: string;
  label?: string;
  busyLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setState("busy");
    setError(null);
    try {
      let blob: Blob;
      if ("bytes" in source) {
        blob = new Blob([new Uint8Array(source.bytes)], { type: "application/pdf" });
      } else {
        const res = await fetch(source.href, { cache: "no-store" });
        if (!res.ok) throw new Error(`the till answered ${res.status}`);
        blob = await res.blob();
      }
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
      setError(
        "bytes" in source
          ? "Could not open the share sheet. The PDF can still be downloaded."
          : "Could not get the PDF. Check the connection and try again.",
      );
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
        {state === "busy" ? busyLabel : label}
      </button>
      {error ? <p className="mt-1.5 text-center text-[11px] font-semibold text-bad">{error}</p> : null}
    </div>
  );
}

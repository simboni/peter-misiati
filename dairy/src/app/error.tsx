"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The screen for a genuine fault — not for a permission (see `forbidden.tsx`)
 * and not for a missing page.
 *
 * Two rules it exists to keep. First, no reference number as the headline: the
 * default screen led with `ERROR 230055567`, which is precisely the `rc=6`
 * dead end this product was written against. The digest is still shown, small,
 * at the bottom, because it is the one thing that makes a phone call to support
 * useful — but it is the footnote, not the message.
 *
 * Second, more than one way out. The old screen offered Reload, which on a page
 * that fails deterministically reloads into the same wall.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The browser console is the only place this is visible to whoever is
    // sitting with the farm when it happens.
    console.error("Page failed:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center p-6">
      <p className="text-4xl" aria-hidden>
        🛠️
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-ink">This screen did not open</h1>
      <p className="mt-3 text-base text-ink-2">
        Something on our side went wrong. Nothing you already saved has been lost — every
        record that showed you a receipt is still on the farm&rsquo;s books.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <button
          type="button"
          onClick={reset}
          className="tap inline-flex min-h-12 items-center justify-center rounded-md bg-brand px-5 text-base font-semibold text-white"
        >
          Try this screen again
        </button>
        <Link
          href="/"
          className="tap inline-flex min-h-12 items-center justify-center rounded-md border border-line bg-surface px-5 text-base font-semibold text-ink"
        >
          Back to home
        </Link>
        <Link
          href="/support"
          className="tap inline-flex min-h-12 items-center justify-center rounded-md border border-line bg-surface px-5 text-base font-semibold text-ink"
        >
          Tell us what happened
        </Link>
      </div>

      {error.digest ? (
        <p className="mt-8 text-center text-xs text-ink-3">
          If you report this, quote <span className="font-mono">{error.digest}</span>.
        </p>
      ) : null}
    </main>
  );
}

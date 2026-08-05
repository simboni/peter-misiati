"use client";

/**
 * Registers the service worker and declares the PWA head tags.
 *
 * The head tags are rendered here rather than in `layout.tsx` because React 19
 * hoists `<link>` and `<meta>` from anywhere in the tree into `<head>` — which
 * keeps the whole PWA concern in one file that this module owns, instead of
 * scattered through the shared layout.
 *
 * Registration is deliberately quiet: if the browser has no service worker
 * (an old Android WebView, or plain http on a phone that refuses), the app
 * still works — it just cannot be installed or opened offline. Nothing here is
 * allowed to throw into the counter screen.
 */

import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let warmTimer = 0;

    // Registered after load so it never competes with the first paint of the
    // sell grid — the counter has a queue waiting.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => {
          if (cancelled) return;
          // A shop that never closes the app would otherwise sit on an old
          // build for days.
          registration.update().catch(() => {});

          // Save every main screen while the line is good, so Stock, Batch and
          // Debts open on a dead connection too — not just the screens someone
          // happened to visit first. Delayed so it never competes with the
          // first paint of the sell grid; the counter has a queue waiting.
          if (navigator.onLine) {
            warmTimer = window.setTimeout(() => {
              navigator.serviceWorker.ready
                .then((r) => r.active?.postMessage({ type: "WARM" }))
                .catch(() => {});
            }, 4000);
          }
        })
        .catch(() => {
          // Insecure origin, private mode, or the file is not being served.
          // Offline install is a bonus; selling online must not depend on it.
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      if (warmTimer) window.clearTimeout(warmTimer);
      window.removeEventListener("load", register);
    };
  }, []);

  return (
    <>
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="apple-touch-icon" href="/icon-192.png" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Riziki POS" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="mobile-web-app-capable" content="yes" />
    </>
  );
}

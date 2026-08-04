"use client";

/**
 * Registers the service worker, and nothing else.
 *
 * Without it the app is a "PWA" with a manifest and no cache: installed to the
 * home screen, opened in a shed with no signal, and showing Chrome's dinosaur.
 * The manifest was written; this was the missing half.
 *
 * `updateViaCache: "none"` so a new worker is picked up on the next visit
 * rather than being served from the browser's own HTTP cache for a day.
 */

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Registration competes with the first render for a slow phone's CPU, and
    // nothing on screen depends on it, so it waits for the page to settle.
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
        // No worker means no offline cache — the outbox still works, so this is
        // a degraded app, not a broken one. Nothing to show the herdsman.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

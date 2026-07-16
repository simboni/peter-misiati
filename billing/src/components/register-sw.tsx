"use client";

import { useEffect } from "react";

/** Registers the service worker so the app is installable (PWA / TWA). */
export function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    // Register after load so it never competes with first paint.
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);
  return null;
}

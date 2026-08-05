"use client";

/**
 * The one line that stops "offline" feeling like "broken".
 *
 * Offline, the service worker serves the last saved copy of whatever screen was
 * asked for. That is right — a saved Stock list beats a blank page — but a
 * saved page has live-looking buttons on it, and only the counter can actually
 * work without a network: selling queues on the phone, everything else needs
 * the till. So say so, once, at the top of the screen.
 *
 * Deliberately not on /sell: that screen already has its own, better banner
 * naming the outbox count and the moment its stock counts were true.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function OfflineNotice() {
  const path = usePathname();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;
  if (path === "/sell" || path === "/login") return null;

  return (
    <div className="no-print mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn ring-1 ring-inset ring-warn/25">
      No connection — this is the last saved copy of this screen. Selling still works and saves
      on the phone; anything you save here will have to wait for the network.
    </div>
  );
}

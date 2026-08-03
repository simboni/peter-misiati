"use client";

import { useEffect, useRef, useState } from "react";
import { isNativeApp } from "@/lib/native";

/**
 * Pull-to-refresh for the native app. Dragging down while the page is scrolled
 * to the top reveals a spinner that follows the finger; releasing past the
 * threshold reloads the current screen (fresh data from the server). Active only
 * inside the installed app so it never interferes with desktop scrolling.
 */
const THRESHOLD = 72; // px pulled (after resistance) to trigger a refresh
const MAX = 108;

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Mutable state read inside the (once-registered) touch handlers.
  const s = useRef({ startY: 0, active: false, dist: 0, busy: false });

  useEffect(() => {
    if (!isNativeApp()) return;
    const st = s.current;

    const onStart = (e: TouchEvent) => {
      // Not at the very top, mid-refresh, or a bottom sheet is open → ignore.
      if (window.scrollY > 3 || st.busy || document.body.style.overflow === "hidden") {
        st.active = false;
        return;
      }
      st.startY = e.touches[0].clientY;
      st.active = true;
      st.dist = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!st.active || st.busy) return;
      const dy = e.touches[0].clientY - st.startY;
      if (dy <= 0 || window.scrollY > 3) {
        st.active = false;
        st.dist = 0;
        setPull(0);
        return;
      }
      // Rubber-band resistance.
      const d = Math.min(dy * 0.5, MAX);
      st.dist = d;
      setPull(d);
      if (d > 4 && e.cancelable) e.preventDefault(); // hold the page still while pulling
    };

    const onEnd = () => {
      if (!st.active) return;
      st.active = false;
      if (st.dist >= THRESHOLD && !st.busy) {
        st.busy = true;
        setRefreshing(true);
        setPull(THRESHOLD);
        // Let the spinner paint, then reload the current screen.
        window.setTimeout(() => window.location.reload(), 200);
      } else {
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (pull <= 0 && !refreshing) return null;

  const y = Math.min(pull, THRESHOLD);
  const progress = Math.min(pull / THRESHOLD, 1);

  return (
    <div
      className="app-chrome pointer-events-none fixed inset-x-0 z-40 flex justify-center"
      style={{
        top: "calc(var(--tp-safe-top) + 4px)",
        transform: `translateY(${y - 6}px)`,
        opacity: refreshing ? 1 : Math.min(progress + 0.25, 1),
        transition: s.current.active ? "none" : "transform 0.2s ease, opacity 0.2s ease",
      }}
      aria-hidden
    >
      <div className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface shadow-lg">
        <div
          className={`h-5 w-5 rounded-full border-2 border-brand-100 border-t-brand-600 ${refreshing ? "animate-spin" : ""}`}
          style={refreshing ? undefined : { transform: `rotate(${pull * 4}deg)` }}
        />
      </div>
    </div>
  );
}

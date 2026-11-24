"use client";

import { useEffect, useState } from "react";

/**
 * The name of the modifier key on THIS device: "⌘" on a Mac, "Ctrl" elsewhere.
 *
 * The shortcut hints were hard-coded to ⌘, which is wrong for most of the
 * people using TallyPay — Windows desktops and Android. The handlers have
 * always accepted both (`e.metaKey || e.ctrlKey`); only the labels lied.
 *
 * Resolved after mount rather than during render: the server has no idea what
 * the visitor is typing on, so rendering a guess would cause a hydration
 * mismatch. "Ctrl" is the first paint because it is the commoner case.
 */
export function useModKey(): string {
  const [mod, setMod] = useState("Ctrl");
  useEffect(() => {
    const ua = navigator.userAgent || "";
    // navigator.platform is deprecated but still the most reliable signal
    // where it exists; userAgent is the fallback.
    const platform = (navigator as Navigator & { platform?: string }).platform || "";
    if (/Mac|iPhone|iPad|iPod/.test(platform) || /Macintosh|iPhone|iPad/.test(ua)) setMod("⌘");
  }, []);
  return mod;
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Two-key chords, in the style of GitHub and Linear: `g` then `d` for the
 * dashboard, `n` then `i` for a new invoice. The palette's hints advertise
 * these, so they have to exist.
 *
 * Chords rather than modifiers because a vendor invoicing all day shouldn't
 * need both hands, and because single letters are free: the browser and OS
 * have already claimed every useful ⌘-combination.
 *
 * The leader expires after a moment so a stray `g` doesn't lie in wait and
 * swallow the next keystroke.
 */

const LEADER_MS = 1200;

const GO: Record<string, string> = {
  d: "/dashboard",
  i: "/invoices",
  r: "/reminders",
  q: "/quotations",
  c: "/clients",
  e: "/expenses",
  p: "/reports", // "p" for performance; "r" is taken by reminders
  s: "/settings",
  t: "/items", // "t" for the item caTalogue
  k: "/receipts",
};

const NEW: Record<string, string> = {
  i: "/invoices/new",
  q: "/quotations/new",
  c: "/clients/new",
  e: "/expenses/new",
  t: "/items/new",
  d: "/delivery-notes/new",
};

export function KeyboardShortcuts() {
  const router = useRouter();
  const [leader, setLeader] = useState<"g" | "n" | null>(null);

  useEffect(() => {
    if (!leader) return;
    const t = setTimeout(() => setLeader(null), LEADER_MS);
    return () => clearTimeout(t);
  }, [leader]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal a key from someone filling in a form, and never from a
      // real shortcut the user meant for the browser.
      const el = e.target;
      const inField =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      if (inField || e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();

      if (leader) {
        const map = leader === "g" ? GO : NEW;
        const href = map[key];
        setLeader(null);
        if (href) {
          e.preventDefault();
          router.push(href);
        }
        return;
      }

      if (key === "g" || key === "n") {
        e.preventDefault();
        setLeader(key as "g" | "n");
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leader, router]);

  if (!leader) return null;

  // A small cue, so a half-finished chord is visible rather than mysterious.
  return (
    <div className="no-print pointer-events-none fixed bottom-4 left-1/2 z-[90] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs shadow-lg">
        <kbd className="rounded border border-line px-1.5 py-0.5 font-bold text-ink">
          {leader.toUpperCase()}
        </kbd>
        <span className="text-muted">
          {leader === "g" ? "go to… D I R Q C E P S T K" : "new… I Q C E T D"}
        </span>
      </div>
    </div>
  );
}

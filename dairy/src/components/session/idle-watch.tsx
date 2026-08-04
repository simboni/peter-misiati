"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The device-side half of the idle timeout.
 *
 * Four people share one phone through a 5am milking. A session that outlives
 * the person holding it silently reassigns everything the next three do, which
 * destroys exactly the accountability the PIN-and-face picker exists to
 * provide. `IDLE_TIMEOUT_SECONDS` has said 60 in `src/lib/session.ts` since the
 * beginning and nothing read it; sessions ran for twelve hours.
 *
 * It has to be measured HERE, not on the server, because entering a milking
 * makes no network requests at all (R3). A server-side sixty-second window
 * would sign a man out in the middle of a sheet he had been filling for ten
 * minutes, which is the one thing this must never do.
 *
 * So the rule is: idle means nobody has touched the screen, AND there is
 * nothing half-entered to lose. A form with typing in it is never interrupted —
 * the watcher waits. The worst case here is "tap your face again". It is never
 * "type it all again".
 */

/** Matches `IDLE_TIMEOUT_SECONDS` in src/lib/session.ts. */
const IDLE_SECONDS = 60;
/** How long the "still there?" card shows before it signs out. */
const GRACE_SECONDS = 10;

const ACTIVITY = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;

export function IdleWatch({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const router = useRouter();
  const [countdown, setCountdown] = useState<number | null>(null);
  const lastActive = useRef(Date.now());

  useEffect(() => {
    const bump = () => {
      lastActive.current = Date.now();
      setCountdown(null);
    };
    for (const e of ACTIVITY) window.addEventListener(e, bump, { passive: true });
    document.addEventListener("visibilitychange", bump);

    const tick = window.setInterval(() => {
      // Never interrupt work in progress. A herdsman who has typed six cows in
      // and paused to move a stubborn one still owns this phone.
      if (hasUnsavedWork()) {
        lastActive.current = Date.now();
        return;
      }
      const idleFor = (Date.now() - lastActive.current) / 1000;
      if (idleFor < IDLE_SECONDS) return;

      const left = Math.ceil(IDLE_SECONDS + GRACE_SECONDS - idleFor);
      if (left > 0) {
        setCountdown(left);
      } else {
        void signOutAction().then(() => router.refresh());
      }
    }, 1000);

    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, bump);
      document.removeEventListener("visibilitychange", bump);
      window.clearInterval(tick);
    };
  }, [router, signOutAction]);

  if (countdown == null) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface p-4 shadow-lg"
    >
      <p className="text-base font-semibold text-ink">Still you?</p>
      <p className="mt-1 text-sm text-ink-2">
        Going back to the name list in {countdown} second{countdown === 1 ? "" : "s"}, so the
        next person&rsquo;s work is not put under your name.
      </p>
      <button
        type="button"
        onClick={() => {
          lastActive.current = Date.now();
          setCountdown(null);
        }}
        className="tap mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-md bg-brand px-5 text-base font-semibold text-white"
      >
        Keep me signed in
      </button>
    </div>
  );
}

/**
 * Is there typing on this screen that a sign-out would throw away?
 *
 * Deliberately a DOM question rather than a piece of shared state: every form
 * in the app would otherwise have to remember to register itself, and the one
 * that forgot would be the one that lost a milking.
 */
function hasUnsavedWork(): boolean {
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "form input, form textarea",
  );
  for (const f of fields) {
    if (f.type === "hidden" || f.type === "submit" || f.disabled) continue;
    if (f.type === "checkbox" || f.type === "radio") {
      if ((f as HTMLInputElement).checked !== (f as HTMLInputElement).defaultChecked) return true;
      continue;
    }
    if (f.value !== f.defaultValue) return true;
  }
  return false;
}

"use client";

/**
 * Sign out, and empty the offline cache on the way.
 *
 * Clearing the cookie ends the session on the server. It does nothing about
 * the pages the service worker has already saved on the phone, and those are
 * whatever the person signing out could see: the home screen carries the
 * shelf at cost and the day's gross profit, the sales list prints what each
 * line cost, the stock list is valued at cost. One counter phone, two people
 * — so the next person to sign in and lose signal would have been served the
 * previous one's screens, with figures an attendant is not meant to have.
 *
 * A client component for one reason: a server action cannot reach the service
 * worker. `controller` is the worker already driving this page, and
 * postMessage to it is synchronous — so the purge is handed over before the
 * form submits, with nothing awaited and nothing intercepted. Signing out
 * must never hang on a cache that will not clear, so there is no
 * preventDefault here and no promise to lose: the action runs either way, on
 * a browser with no service worker as much as on one that has it.
 */

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form
      action={action}
      onSubmit={() => {
        try {
          navigator.serviceWorker?.controller?.postMessage({ type: "PURGE" });
        } catch {
          // No worker, or it would not take the message. Sign out regardless.
        }
      }}
    >
      <button
        type="submit"
        className="flex min-h-11 items-center rounded-full px-3.5 text-[11px] font-bold text-frost ring-1 ring-inset ring-white/30"
      >
        Sign out
      </button>
    </form>
  );
}

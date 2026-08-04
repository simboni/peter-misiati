"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * What a herdsman sees when he taps a link his role cannot open.
 *
 * The old behaviour was a 500 and `ERROR 230055567` with a Reload button that
 * reloaded the same wall. Five screens did it — including "Review queue",
 * linked from the top of the milk sheet he opens twice a day.
 *
 * Nothing here is an apology and nothing is an error. It names the screen, says
 * plainly whose job it is, and gives two ways out that are one tap each.
 */

/** Route → the name the farm calls it. Used for the headline only. */
const SCREEN_NAME: Record<string, string> = {
  "/milk/flagged": "Milk to check",
  "/feed/purchase": "Buying feed",
  "/feed/fodder": "Fodder made on the farm",
  "/health/treat": "Treating an animal",
  "/health/vaccinate": "Vaccinating",
  "/health/cmt": "The mastitis test",
  "/health/batch": "Treating a group",
  "/sales/statement": "Checking the co-op statement",
  "/sales": "Where the milk went",
  "/sales/aging": "Who owes the farm",
  "/sales/customers": "Customers",
  "/money": "Money",
  "/money/approve": "Approving what was spent",
  "/people": "People and pay",
  "/reports": "Reports",
};

export default function Forbidden() {
  const path = usePathname();
  const name = SCREEN_NAME[path ?? ""] ?? null;

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center p-6">
      <p className="text-4xl" aria-hidden>
        🔒
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-ink">
        {name ? `${name} is not yours to open` : "This page is not yours to open"}
      </h1>
      <p className="mt-3 text-base text-ink-2">
        Nothing is broken and nothing you recorded was lost. This part of the farm is
        handled by the owner or a manager.
      </p>
      <p className="mt-2 text-base text-ink-2">
        If you need it, hand them the phone — or ask them to sign in and do it.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <Link
          href="/"
          className="tap inline-flex min-h-12 items-center justify-center rounded-md bg-brand px-5 text-base font-semibold text-white"
        >
          Back to home
        </Link>
        <Link
          href="/alerts"
          className="tap inline-flex min-h-12 items-center justify-center rounded-md border border-line bg-surface px-5 text-base font-semibold text-ink"
        >
          Today&rsquo;s jobs
        </Link>
      </div>
    </main>
  );
}

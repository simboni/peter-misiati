"use client";

/**
 * Whether the phone thinks it has a network.
 *
 * One answer, in one place. The counter and the offline banner both need it and
 * both used to work it out for themselves — each setting state from inside an
 * effect on mount, so each screen painted once believing it was online and
 * again once it had asked. Two components asking the same question two ways is
 * also two places for the answer to drift.
 *
 * This is state that lives outside React, so React reads it the way it reads
 * anything outside itself: a subscription and a snapshot.
 *
 * The interval is not belt-and-braces. A cheap Android on one bar does not
 * reliably fire `online`/`offline`, and a counter that believes it is offline
 * when it is not stops sending the queue — which is the failure that leaves a
 * day's sales on a phone.
 */

const RECHECK_MS = 20_000;

export function subscribeOnline(fn: () => void): () => void {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  const timer = window.setInterval(fn, RECHECK_MS);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
    window.clearInterval(timer);
  };
}

export function readOnline(): boolean {
  return navigator.onLine;
}

/**
 * What the server must assume.
 *
 * Online, because that is the quiet answer: the first paint then carries no
 * banner and no "saving on this phone" button, and a page rendered on a machine
 * with no phone attached should not announce a network fault it cannot know
 * about.
 */
export function assumeOnline(): boolean {
  return true;
}

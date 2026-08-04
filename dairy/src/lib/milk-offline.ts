/**
 * The client-side half of `src/server/milk.ts`.
 *
 * Two things the milk sheet needs while the phone is offline, and cannot get by
 * importing the server module — `src/server/milk.ts` is `server-only`, so
 * pulling it into a client component would break the build:
 *
 *   1. Which lock reasons keep milk out of the can. The rule is written once on
 *      the server and once here, and `milk-offline.test.ts` asserts the two
 *      agree for every reason, so they cannot drift apart quietly. This is the
 *      third time this particular rule has failed open.
 *   2. The receipt reference code. Derived identically to the server's, so a
 *      milking saved with no signal shows the SAME five characters that the
 *      office will see when it lands. One milking, one code.
 *
 * Only the TYPES come from the server module, and types are erased at build
 * time — that import ships nothing to the browser.
 */

import type { LockReason } from "@/server/milk";

/**
 * Both withdrawal reasons keep milk out of the can. WITHDRAWAL_UNKNOWN is not a
 * softer WITHDRAWAL — it means nobody recorded the label period, so the cow is
 * being held on an assumed window. Treating it as ordinary is exactly how
 * residue reaches the churn.
 *
 * Colostrum is deliberately NOT here. It is not saleable either, but it is not
 * the legal hard stop; R4 allows exactly one of those and this is it.
 */
export function isWithheldReason(reason: LockReason | null | undefined): boolean {
  return reason === "WITHDRAWAL" || reason === "WITHDRAWAL_UNKNOWN";
}

/**
 * Deliberately excludes I, O, 0 and 1, so a code read aloud across a milking
 * parlour cannot be misheard. Must stay identical to `REF_ALPHABET` in
 * `src/server/milk.ts`.
 */
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * The exact seed `recordMilkBatch` hashes. Row ids are sorted, so the code does
 * not depend on the order the cows happened to be typed in.
 */
export function milkRefSeed(
  farmId: string,
  date: string,
  session: string,
  rowIds: string[],
): string {
  return `${farmId}|${date}|${session}|${[...rowIds].sort().join(",")}`;
}

/**
 * The same code the server will derive, computed on the device.
 *
 * Returns null when the browser cannot hash — `crypto.subtle` is missing
 * outside a secure context, e.g. a plain-http install. In that case the sheet
 * shows a receipt with no code rather than a code that would later turn out to
 * be a different one. A reference number that changes is worse than none: it is
 * the thing the herdsman quotes to the manager.
 */
export async function deterministicRefOnDevice(
  prefix: string,
  seed: string,
  length = 5,
): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = new Uint8Array(
      await subtle.digest("SHA-256", new TextEncoder().encode(seed)),
    );
    let out = "";
    for (let i = 0; i < length; i++) out += REF_ALPHABET[digest[i] % REF_ALPHABET.length];
    return `${prefix}${out}`;
  } catch {
    return null;
  }
}

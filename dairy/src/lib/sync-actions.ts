"use server";

/**
 * The one door the outbox drains through.
 *
 * The background flusher runs in the root layout, on every screen, so it cannot
 * import a module's Server Action the way a form does — it has no page to hand
 * it one. This module is that hand-off: the layout imports it on the server and
 * passes it down as a prop, which is the supported way to give a client
 * component a Server Action.
 *
 * Two rules here, both learned the hard way:
 *
 *   - Declare the actions with `export async function`. A bare `export { x }`
 *     re-export silently switches off the server-action transform for the whole
 *     module and every action in it starts 404-ing.
 *   - NEVER throw. This runs in the background while somebody is halfway
 *     through a milking. A thrown redirect from an expired session would yank
 *     the phone to the sign-in screen mid-sheet, and a thrown error would land
 *     the whole app in the crash boundary because of a sync job nobody asked
 *     for. Everything comes back as a value.
 */

import { saveMilkSheetAction } from "@/server/milk";

export interface OutboxSendResult {
  ok: boolean;
  /** Plain language, safe to show. Only set when `ok` is false. */
  error?: string;
  /** True when retrying cannot help — a payload this server will never accept. */
  permanent?: boolean;
  /** True when the phone simply has nobody signed in. Not a failure of the entry. */
  needsSignIn?: boolean;
  /** The receipt code, once the office has it. */
  refCode?: string;
}

/** Sent by `redirect()` — here, always the bounce to /login from an expired session. */
const REDIRECT_DIGEST = "NEXT_REDIRECT";

export async function sendOutboxEntryAction(
  kind: string,
  payload: unknown,
): Promise<OutboxSendResult> {
  try {
    switch (kind) {
      case "MILK_BATCH":
        return await sendMilkBatch(payload);
      default:
        // An entry written by a newer version of the app than this server
        // knows. Retrying forever will not teach it, so say so once.
        return { ok: false, permanent: true, error: "This phone saved something this office does not recognise." };
    }
  } catch (err) {
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith(REDIRECT_DIGEST)) {
      return { ok: false, needsSignIn: true, error: "Nobody is signed in on this phone." };
    }
    return { ok: false, error: "The office could not be reached." };
  }
}

async function sendMilkBatch(payload: unknown): Promise<OutboxSendResult> {
  const p = (payload ?? {}) as { date?: unknown; session?: unknown; rows?: unknown };

  // The queue stores exactly what the form posted, so it replays through the
  // same Server Action — same capability check, same ownership check, same
  // idempotent insert. A replay of an already-sent batch comes back ok with
  // the same reference code, which is the point.
  const formData = new FormData();
  formData.set("date", String(p.date ?? ""));
  formData.set("session", String(p.session ?? ""));
  formData.set("rows", typeof p.rows === "string" ? p.rows : JSON.stringify(p.rows ?? []));

  const result = await saveMilkSheetAction(null, formData);
  if (result.ok) return { ok: true, refCode: result.refCode };
  return { ok: false, error: result.error };
}

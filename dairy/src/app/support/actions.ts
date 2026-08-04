"use server";

import { guard, requireCapability, type ActionResult } from "@/lib/dal";
import { raiseTicketFor } from "@/server/support";

/**
 * Server Actions for the support form, in their own `"use server"` module.
 *
 * The action used to live inside `@/server/support.ts` with a function-level
 * `"use server"`. That made the whole module a client import target, and since
 * it reaches `@/lib/dal` and `@/lib/session` — both `server-only` — the browser
 * bundle pulled in code that refuses to be bundled, and every route 500'd.
 *
 * A module-level `"use server"` file is the boundary: the client imports only
 * this, and Next replaces it with a reference rather than the implementation.
 */
export async function raiseTicketAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    const session = await requireCapability("RECORD");

    const raw = formData.get("syncState");
    let syncState: Record<string, unknown> | undefined;
    if (typeof raw === "string" && raw) {
      try {
        syncState = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // A malformed sync blob is diagnostic noise, not a reason to lose the
        // user's message. Keep the ticket, drop the blob.
        syncState = { unparsed: raw.slice(0, 500) };
      }
    }

    return raiseTicketFor(session, {
      message: String(formData.get("message") ?? ""),
      screen: String(formData.get("screen") ?? "") || undefined,
      syncState,
    });
  });
}

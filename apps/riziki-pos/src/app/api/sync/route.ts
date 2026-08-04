/**
 * `POST /api/sync` — drain the counter phone's offline outbox.
 *
 * This is the only write endpoint that accepts work the device did while it was
 * on its own, and it accepts exactly one kind: a sale. Nothing owner-sensitive
 * and nothing conflict-prone queues, so there is no merge to do here — only a
 * replay, and `recordSale()` already makes a replay free of consequence.
 *
 * Three things this route must get right:
 *
 *  1. **A queued sale still belongs to a signed-in user.** `requireUser()` runs
 *     first, exactly as it would for the online sale. If the session expired
 *     while the phone was offline the answer is 401 and the client *keeps* the
 *     sale — discarding it would turn an expired cookie into lost takings.
 *
 *  2. **One verdict per sale.** Each is recorded in its own try/catch so a
 *     single refusal cannot hold up a morning's worth of good ones. The reply
 *     says accepted / duplicate / failed per sale, which is precisely what the
 *     client needs to know what it may forget.
 *
 *  3. **Never cached.** No-store on the way out, and the service worker skips
 *     this path entirely.
 */

import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/db";
import { authoriseOwnerPin, recordSale } from "@/lib/sales";
import { MAX_SYNC_BATCH, summariseOutcomes, syncQueuedSales } from "@/lib/offline";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  let userId: number;
  try {
    const user = await requireUser();
    userId = user.id;
  } catch {
    return json(
      {
        ok: false,
        error: "session_expired",
        message: "Your session ended. Sign in again — the sales are still saved on this phone.",
      },
      401,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json", message: "That was not a readable batch." }, 400);
  }

  const sales = (body as { sales?: unknown })?.sales;
  if (!Array.isArray(sales)) {
    return json({ ok: false, error: "bad_request", message: "Send a `sales` array." }, 400);
  }
  if (sales.length > MAX_SYNC_BATCH) {
    return json(
      {
        ok: false,
        error: "too_many",
        message: `Send at most ${MAX_SYNC_BATCH} sales at a time.`,
      },
      413,
    );
  }
  if (!sales.length) {
    return json({ ok: true, results: [] });
  }

  // A price haggled below the floor while offline could not be approved at the
  // time — the counter never receives `floor_cents`. The PIN is therefore typed
  // at send time, never stored on the device, and an absent or wrong PIN simply
  // leaves those sales refused and still queued.
  let floorOverrideBy: number | null = null;
  const ownerPin = (body as { ownerPin?: unknown })?.ownerPin;
  if (typeof ownerPin === "string" && ownerPin.trim()) {
    floorOverrideBy = authoriseOwnerPin(ownerPin);
  }

  const results = syncQueuedSales(sales, { userId, record: recordSale, floorOverrideBy });
  const counts = summariseOutcomes(results);

  // Worth an audit line: it is the shop's own record of how long the line was
  // down and what came in late.
  audit(
    userId,
    "sync_offline_sales",
    "sale",
    null,
    `${counts.accepted} recorded, ${counts.duplicate} already recorded, ${counts.failed} refused`,
  );

  return json({ ok: true, results });
}

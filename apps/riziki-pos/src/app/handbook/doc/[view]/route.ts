/**
 * Serves the handbook document that `/handbook` shows in its frame.
 *
 * The role is in the path — `/handbook/doc/owner` and `/handbook/doc/staff` —
 * rather than in a query string or decided invisibly from the session, because
 * the service worker keys its cache on the path and drops the query. One URL
 * serving two different documents would mean the copy cached while the owner
 * was reading is the copy an attendant gets handed on a dead connection, with
 * the recipes in it. Two paths, two cache entries, no crossover.
 *
 * The path is a request, not a permission: asking for the owner copy without
 * being the owner is refused here, server-side.
 */

import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { handbookFor, type HandbookView } from "@/lib/handbook";

export const dynamic = "force-dynamic";

/** A frame is a bad place to land on the sign-in screen, so say it in words. */
function signedOut(): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<body style="margin:0;display:grid;place-items:center;min-height:100vh;` +
      `font:600 15px/1.5 ui-sans-serif,system-ui,sans-serif;color:#47646a;background:#f2f7f7">` +
      `<p style="padding:2rem;text-align:center">Your session has ended.<br>Sign in again to read the handbook.</p>`,
    { status: 401, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ view: string }> },
) {
  const { view } = await params;
  if (view !== "owner" && view !== "staff") return new Response("Not found", { status: 404 });

  const user = await currentUser();
  if (!user) return signedOut();
  if (view === "owner" && user.role !== "owner") {
    return new Response("The full handbook is the owner's.", { status: 403 });
  }

  const html = handbookFor(view as HandbookView);

  // The document only changes when the app is redeployed, and it is ~3 MB — on
  // the shop's mobile data that is worth a revalidation rather than a resend.
  // Weak, because the length is enough to tell the two variants apart.
  const etag = `W/"handbook-${view}-${html.length}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      etag,
      // Private: this copy was cut for one role and must never be held by a
      // shared cache and handed to the other.
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}

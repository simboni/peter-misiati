import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getEnv, appBaseUrl } from "@/server/config";
import { runDueReminders } from "@/server/reminder-queue";

export const dynamic = "force-dynamic";

/**
 * Nightly reminder sweep, for cron:
 *
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
 *     https://tallypay.smp.co.ke/api/cron/reminders
 *
 * Page loads also send what is due (see chaseSummary), so this endpoint is
 * what makes reminders land for a vendor who hasn't opened the app that week —
 * which is exactly the vendor whose invoices are going unpaid.
 *
 * Fails CLOSED: with no CRON_SECRET configured the route refuses every request
 * rather than letting anyone on the internet trigger a mail run.
 */
export async function GET(req: Request) {
  const env = await getEnv();
  const secret = env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!timingSafeEqual(presented, secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const baseUrl = await appBaseUrl();
  const now = new Date();

  // Every org with reminders switched on — one sweep per tenant.
  const orgs = await db
    .select({ id: schema.orgProfile.organizationId })
    .from(schema.orgProfile)
    .where(eq(schema.orgProfile.remindersEnabled, true));

  let sent = 0;
  const failed: string[] = [];
  for (const o of orgs) {
    try {
      sent += await runDueReminders(db, o.id, baseUrl, now);
    } catch (e) {
      console.error("cron/reminders: org failed", o.id, e);
      failed.push(o.id);
    }
  }

  return Response.json({ ok: true, orgs: orgs.length, sent, failed: failed.length });
}

/** Constant-time string compare, so a wrong secret leaks nothing by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

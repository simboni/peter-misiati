import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { verifySignature, parseWebhook, normalizeStatus } from "@/server/kopokopo";
import { kopokopoConfigForOrg } from "@/server/payments-config";
import { settleIntent } from "@/server/settle";

export const dynamic = "force-dynamic";

// Kopo Kopo posts the STK-push result here. Because each vendor may use their
// own API key, we identify the intent from the (untrusted) body first, resolve
// that org's config, and only then verify the HMAC signature with its key and
// settle. Nothing is acted on until the signature checks out.
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-kopokopo-signature") || "";

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const { status, reference, ref } = parseWebhook(body);
  const b = body as Record<string, unknown>;
  const data = (b?.data ?? b) as Record<string, unknown>;
  const attributes = (data?.attributes ?? data) as Record<string, unknown>;
  const metadata = ((attributes?.metadata ?? b?.metadata) ?? {}) as Record<string, string>;
  const intentId = metadata?.intentId;

  const db = await getDb();
  let intent = null as typeof schema.paymentIntent.$inferSelect | null;
  if (intentId) {
    const r = await db.select().from(schema.paymentIntent).where(eq(schema.paymentIntent.id, intentId)).limit(1);
    intent = r[0] ?? null;
  }
  if (!intent && ref) {
    const r = await db
      .select()
      .from(schema.paymentIntent)
      .where(and(eq(schema.paymentIntent.providerRef, ref), eq(schema.paymentIntent.status, "pending")))
      .limit(1);
    intent = r[0] ?? null;
  }
  // Unknown intent — ack so Kopo Kopo stops retrying, but do nothing.
  if (!intent) return new Response("ok", { status: 200 });

  // Verify with the API key of the account this intent belongs to.
  const cfg = await kopokopoConfigForOrg(db, intent.organizationId);
  if (!cfg || !(await verifySignature(raw, signature, cfg.apiKey))) {
    return new Response("invalid signature", { status: 401 });
  }

  const norm = normalizeStatus(status);
  if (norm === "success") {
    await settleIntent(db, intent, reference ?? null);
  } else if (norm === "failed") {
    await db
      .update(schema.paymentIntent)
      .set({ status: "failed", errorMessage: "Payment was not completed." })
      .where(eq(schema.paymentIntent.id, intent.id));
  }
  return new Response("ok", { status: 200 });
}

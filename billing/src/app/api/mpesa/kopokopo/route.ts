import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { kopokopoConfig } from "@/server/config";
import { verifySignature, parseWebhook, normalizeStatus } from "@/server/kopokopo";
import { settleIntent } from "@/server/settle";

export const dynamic = "force-dynamic";

// Kopo Kopo posts the STK-push result here. We verify the HMAC signature, then
// settle the matching intent into a payment/receipt. Always 200 once verified
// so Kopo Kopo doesn't retry a message we've accepted.
export async function POST(req: Request) {
  const cfg = await kopokopoConfig();
  if (!cfg) return new Response("ok", { status: 200 }); // not configured — ignore

  const raw = await req.text();
  const signature = req.headers.get("x-kopokopo-signature") || "";
  if (!(await verifySignature(raw, signature, cfg.apiKey))) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const { status, reference, ref } = parseWebhook(body);
  // Prefer our own intentId from metadata; fall back to the provider resource id.
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
  if (!intent) return new Response("ok", { status: 200 });

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

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { queryStatus, normalizeStatus } from "@/server/kopokopo";
import { settleIntent } from "@/server/settle";

export const dynamic = "force-dynamic";

// Public: the pay page polls this to learn the STK-push outcome. If the webhook
// hasn't reached us (e.g. no public URL in dev), we actively query Kopo Kopo.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const intentId = url.searchParams.get("intent") || "";
  if (!intentId) return Response.json({ status: "error", error: "missing intent" }, { status: 400 });

  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.paymentIntent)
    .where(eq(schema.paymentIntent.id, intentId))
    .limit(1);
  const intent = rows[0];
  if (!intent) return Response.json({ status: "error", error: "not found" }, { status: 404 });

  async function receiptToken(paymentId: string | null): Promise<string | null> {
    if (!paymentId) return null;
    const p = await db
      .select({ token: schema.payment.shareToken })
      .from(schema.payment)
      .where(eq(schema.payment.id, paymentId))
      .limit(1);
    return p[0]?.token ?? null;
  }

  if (intent.status === "success") {
    return Response.json({ status: "success", receiptToken: await receiptToken(intent.paymentId) });
  }
  if (intent.status === "failed") {
    return Response.json({ status: "failed", error: intent.errorMessage ?? "Payment failed." });
  }

  // Still pending — ask Kopo Kopo directly (webhook fallback).
  if (intent.providerRef) {
    const s = await queryStatus(intent.providerRef);
    if (s) {
      const norm = normalizeStatus(s.status);
      if (norm === "success") {
        const settled = await settleIntent(db, intent, s.reference ?? null);
        return Response.json({ status: "success", receiptToken: settled?.receiptToken ?? null });
      }
      if (norm === "failed") {
        await db
          .update(schema.paymentIntent)
          .set({ status: "failed", errorMessage: "Payment was not completed." })
          .where(eq(schema.paymentIntent.id, intent.id));
        return Response.json({ status: "failed", error: "Payment was not completed." });
      }
    }
  }

  return Response.json({ status: "pending" });
}

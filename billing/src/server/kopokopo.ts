import type { KopoKopoConfig } from "./config";

// ---------------------------------------------------------------------------
// Kopo Kopo M-Pesa STK-push client.
//   OAuth:   POST {base}/oauth/token           (client_credentials)
//   STK:     POST {base}/api/v1/incoming_payments  -> 201 + Location header
//   Status:  GET  {location}                   -> data.attributes.status
//   Webhook: POST callback_url, header X-KopoKopo-Signature = HMAC-SHA256(rawBody, apiKey)
// ---------------------------------------------------------------------------

/** Normalise a Kenyan phone number to +2547XXXXXXXX / +2541XXXXXXXX. */
export function normalizePhone(input: string): string | null {
  const digits = String(input || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
  let d = digits;
  if (d.startsWith("0")) d = "254" + d.slice(1);
  else if (d.startsWith("7") || d.startsWith("1")) d = "254" + d;
  else if (d.startsWith("254")) d = d;
  else return null;
  if (!/^254(7|1)\d{8}$/.test(d)) return null;
  return "+" + d;
}

/** Map Kopo Kopo status strings to our intent status. */
export function normalizeStatus(raw: string): "success" | "failed" | "pending" {
  const s = (raw || "").toLowerCase();
  if (["received", "success", "successful", "completed", "settled"].includes(s)) return "success";
  if (["failed", "cancelled", "canceled", "error", "declined"].includes(s)) return "failed";
  return "pending";
}

/** Verify a Kopo Kopo webhook HMAC-SHA256 signature (Web Crypto; Workers-safe). */
export async function verifySignature(
  rawBody: string,
  signatureHex: string,
  apiKey: string,
): Promise<boolean> {
  if (!signatureHex) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const a = hex.toLowerCase();
  const b = signatureHex.toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function getToken(cfg: KopoKopoConfig): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`kopokopo auth ${res.status}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("kopokopo auth: no token");
  return j.access_token;
}

export type StkResult = { ok: true; location: string } | { ok: false; error: string };

/** Send an STK push using the given (per-vendor or platform) config. */
export async function initiateStkPush(
  cfg: KopoKopoConfig,
  params: {
    amountKes: number;
    phone: string; // already normalised (+2547…)
    callbackUrl: string;
    firstName?: string;
    lastName?: string;
    email?: string | null;
    metadata?: Record<string, string>;
  },
): Promise<StkResult> {
  let token: string;
  try {
    token = await getToken(cfg);
  } catch {
    return { ok: false, error: "Couldn't reach M-Pesa right now. Please try again." };
  }

  const res = await fetch(`${cfg.baseUrl}/api/v1/incoming_payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      payment_channel: "M-PESA STK Push",
      till_number: cfg.tillNumber,
      subscriber: {
        first_name: params.firstName || "Customer",
        last_name: params.lastName || "",
        phone_number: params.phone,
        ...(params.email ? { email: params.email } : {}),
      },
      amount: { currency: "KES", value: String(params.amountKes) },
      metadata: params.metadata ?? {},
      _links: { callback_url: params.callbackUrl },
    }),
  });

  if (res.status !== 201) return { ok: false, error: `M-Pesa request rejected (${res.status}).` };
  const location = res.headers.get("location") || res.headers.get("Location") || "";
  return { ok: true, location };
}

/** Poll an incoming payment's status (fallback when the webhook can't reach us). */
export async function queryStatus(
  cfg: KopoKopoConfig,
  location: string,
): Promise<{ status: string; reference?: string } | null> {
  if (!location) return null;
  let token: string;
  try {
    token = await getToken(cfg);
  } catch {
    return null;
  }
  const res = await fetch(location, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    data?: { attributes?: { status?: string; event?: { resource?: { reference?: string } } } };
  };
  const attr = j?.data?.attributes ?? {};
  return { status: attr.status || "Pending", reference: attr?.event?.resource?.reference };
}

/** Pull status + reference out of a webhook body (defensive across shapes). */
export function parseWebhook(body: unknown): { status: string; reference?: string; ref?: string } {
  const b = body as Record<string, unknown>;
  const data = (b?.data ?? b) as Record<string, unknown>;
  const attributes = (data?.attributes ?? data) as Record<string, unknown>;
  const event = (attributes?.event ?? {}) as Record<string, unknown>;
  const resource = (event?.resource ?? {}) as Record<string, unknown>;
  const status =
    (attributes?.status as string) || (resource?.status as string) || (event?.type as string) || "";
  const reference = (resource?.reference as string) || undefined;
  const ref = (data?.id as string) || (b?.id as string) || undefined;
  return { status, reference, ref };
}

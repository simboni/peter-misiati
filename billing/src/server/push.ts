import { eq } from "drizzle-orm";
import { schema, type DB } from "./db";
import { getEnv } from "./config";

/**
 * Push notifications via Firebase Cloud Messaging (FCM HTTP v1).
 *
 * Dormant until a Firebase service-account JSON is provided in the
 * `FCM_SERVICE_ACCOUNT` Worker secret — every send is a no-op without it, so
 * this ships safely before Firebase is set up. See docs/push-notifications.md.
 */

/** Store (or move) a device token for the current user/org. */
export async function savePushToken(
  db: DB,
  input: { organizationId: string; userId: string; token: string; platform: string },
): Promise<void> {
  if (!input.token) return;
  // A token identifies a device; if it reappears under a different user/org,
  // move it rather than duplicate it.
  await db.delete(schema.pushToken).where(eq(schema.pushToken.token, input.token));
  await db.insert(schema.pushToken).values({
    organizationId: input.organizationId,
    userId: input.userId,
    token: input.token,
    platform: input.platform || "android",
  });
}

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

async function serviceAccount(): Promise<ServiceAccount | null> {
  const env = (await getEnv()) as unknown as Record<string, string | undefined>;
  const raw = env.FCM_SERVICE_ACCOUNT || process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (sa.client_email && sa.private_key && sa.project_id) return sa;
  } catch {
    /* malformed JSON */
  }
  return null;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64urlStr = (str: string) => b64url(new TextEncoder().encode(str));

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// Cache the OAuth token for the isolate's lifetime (FCM tokens last ~1h).
let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlStr(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  cachedToken = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

/** Send a notification to every registered device of an organization. No-op if push isn't configured. */
export async function sendPushToOrg(
  db: DB,
  organizationId: string,
  msg: { title: string; body: string; data?: Record<string, string> },
): Promise<void> {
  const sa = await serviceAccount();
  if (!sa) return;
  const token = await accessToken(sa);
  if (!token) return;

  const rows = await db
    .select({ token: schema.pushToken.token })
    .from(schema.pushToken)
    .where(eq(schema.pushToken.organizationId, organizationId));
  if (rows.length === 0) return;

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  await Promise.all(
    rows.map(async (r) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              token: r.token,
              notification: { title: msg.title, body: msg.body },
              android: { priority: "high" },
              data: msg.data ?? {},
            },
          }),
        });
        // Drop tokens FCM reports as unregistered so the table stays clean.
        if (res.status === 404) {
          await db.delete(schema.pushToken).where(eq(schema.pushToken.token, r.token));
        }
      } catch {
        /* ignore individual delivery failures */
      }
    }),
  );
}

/** "Payment received" alert. Never throws — must not affect the payment flow. */
export async function notifyPaymentReceived(
  db: DB,
  organizationId: string,
  info: { amount: string; invoiceNumber: string },
): Promise<void> {
  try {
    await sendPushToOrg(db, organizationId, {
      title: "Payment received 🎉",
      body: `${info.amount} received on ${info.invoiceNumber}`,
      data: { type: "payment", invoice: info.invoiceNumber },
    });
  } catch {
    /* never break the caller */
  }
}

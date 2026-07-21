export const dynamic = "force-dynamic";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getOrgProfile } from "@/server/org";

/** Resolve which organization a public share token belongs to. */
async function orgIdForToken(db: Awaited<ReturnType<typeof getDb>>, token: string): Promise<string | null> {
  const inv = await db.select({ o: schema.invoice.organizationId }).from(schema.invoice).where(eq(schema.invoice.shareToken, token)).limit(1);
  if (inv[0]) return inv[0].o;
  const pay = await db.select({ o: schema.payment.organizationId }).from(schema.payment).where(eq(schema.payment.shareToken, token)).limit(1);
  if (pay[0]) return pay[0].o;
  const dn = await db.select({ o: schema.deliveryNote.organizationId }).from(schema.deliveryNote).where(eq(schema.deliveryNote.shareToken, token)).limit(1);
  if (dn[0]) return dn[0].o;
  const cn = await db.select({ o: schema.creditNote.organizationId }).from(schema.creditNote).where(eq(schema.creditNote.shareToken, token)).limit(1);
  if (cn[0]) return cn[0].o;
  return null;
}

/**
 * Serve the issuing vendor's logo for a shared document — used as the Open
 * Graph image so a shared link unfurls with the vendor's brand, not TallyPay's.
 * Logos are stored inline as data URLs, which link scrapers can't read, so we
 * decode them to real image bytes here (or redirect if it's a hosted URL).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const orgId = await orgIdForToken(db, token);
  if (!orgId) return new Response(null, { status: 404 });
  const profile = await getOrgProfile(db, orgId);
  const url = profile?.logoUrl;
  if (!url) return new Response(null, { status: 404 });

  // Only ever serve real raster images from this origin. Echoing the stored
  // MIME back (e.g. text/html or image/svg+xml) would let a vendor host an
  // executable document on our domain — a stored-XSS / phishing primitive — so
  // we allowlist the type and refuse anything else, regardless of what the data
  // URL claims. Extra headers stop sniffing and framing.
  const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
  const SAFE_HEADERS: Record<string, string> = {
    "cache-control": "public, max-age=3600",
    "x-content-type-options": "nosniff",
    "content-disposition": "inline",
    "content-security-policy": "default-src 'none'; sandbox",
  };

  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    const mime = comma > 5 ? url.slice(5, comma).split(";")[0].toLowerCase() : "";
    if (!ALLOWED.has(mime)) return new Response(null, { status: 415 });
    const b64 = url.slice(comma + 1);
    let bin: string;
    try {
      bin = atob(b64);
    } catch {
      return new Response(null, { status: 415 });
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { headers: { "content-type": mime, ...SAFE_HEADERS } });
  }
  // Hosted logo: only follow absolute https URLs, never javascript:/data:/http.
  if (/^https:\/\//i.test(url)) return Response.redirect(url, 302);
  return new Response(null, { status: 415 });
}

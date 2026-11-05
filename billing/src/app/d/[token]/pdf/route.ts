import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getEnv, appBaseUrl } from "@/server/config";

export const dynamic = "force-dynamic";

// Render the shared document to a downloadable A4 PDF with headless Chromium.
// The PDF preserves the document's links, so the "Pay online" link stays
// clickable. Returns 501 when no Chromium binary is configured.
//
// Chromium is launched per request rather than kept warm: PDF export is
// occasional, and a long-lived browser that dies leaves every later export
// broken until the container restarts. The cost is ~1s of start-up.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const env = await getEnv();
  const executablePath = env.CHROMIUM_PATH;
  if (!executablePath) {
    return new Response("PDF export is not enabled for this deployment.", { status: 501 });
  }

  // Resolve a friendly filename + confirm the token exists.
  const db = await getDb();
  const [inv, pay, dn] = await Promise.all([
    db.select({ number: schema.invoice.number }).from(schema.invoice).where(eq(schema.invoice.shareToken, token)).limit(1),
    db.select({ number: schema.payment.number }).from(schema.payment).where(eq(schema.payment.shareToken, token)).limit(1),
    db.select({ number: schema.deliveryNote.number }).from(schema.deliveryNote).where(eq(schema.deliveryNote.shareToken, token)).limit(1),
  ]);
  const name = inv[0]?.number || pay[0]?.number || dn[0]?.number;
  if (!name) return new Response("Not found", { status: 404 });

  const base = await appBaseUrl();
  let browser: Awaited<ReturnType<(typeof import("puppeteer-core"))["default"]["launch"]>> | null = null;
  try {
    const { default: puppeteer } = await import("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath,
      // The container runs unprivileged with a small /dev/shm; without these
      // Chromium either refuses to start or crashes on the first page.
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.goto(`${base}/d/${token}`, { waitUntil: "networkidle0", timeout: 30_000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" },
    });
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Couldn't generate the PDF right now. Please use Print / Save as PDF.", {
      status: 502,
    });
  } finally {
    if (browser) await browser.close();
  }
}

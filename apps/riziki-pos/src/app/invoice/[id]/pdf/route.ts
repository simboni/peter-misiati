/**
 * `GET /invoice/[id]/pdf` — the same invoice, as a file.
 *
 * The screen at `/invoice/[id]` is what the counter looks at and what the
 * printer prints from; this route exists for the moment a customer needs
 * something that leaves the shop as a document rather than a screen — emailed,
 * saved to Drive, or handed to WhatsApp as an actual attachment (the click-to-
 * chat link `waLink()` opens can only ever pre-fill text; there is no way to
 * attach a file through it, which is why a proper PDF has to come from
 * somewhere else). Same snapshot columns, same `renderReceipt()` layout as the
 * printed copy — this can never disagree with what the customer was handed.
 */

import { requireUser } from "@/lib/auth";
import { getInvoice } from "@/lib/credit";
import { getPrintSettings, receiptFromInvoice } from "@/lib/print-settings";
import { receiptToPdf } from "@/lib/pdf";
import { printLogo } from "@/lib/brand";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
  } catch {
    return new Response("Please sign in to continue.\n", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { id } = await props.params;
  const saleId = Number(id);
  if (!Number.isInteger(saleId)) {
    return new Response("Not found.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const invoice = getInvoice(saleId);
  if (!invoice) {
    return new Response("Not found.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const receipt = receiptFromInvoice(invoice, getPrintSettings());
  const bytes = receiptToPdf(receipt, printLogo());
  const name = invoice.sale.invoice_no ?? `sale-${invoice.sale.id}`;

  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      // Inline, not attachment: opening it in the browser's own PDF viewer is
      // one tap away from that viewer's own Share button, which is what
      // actually gets it into WhatsApp as a file on a phone.
      "content-disposition": `inline; filename="${name}.pdf"`,
      "content-length": String(bytes.byteLength),
      "cache-control": "no-store",
    },
  });
}

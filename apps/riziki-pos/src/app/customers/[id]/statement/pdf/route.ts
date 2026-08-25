/**
 * `GET /customers/[id]/statement/pdf` — the statement, as a file.
 *
 * The screen at `/customers/[id]/statement` is what gets printed at the
 * counter on A5; this is the same content as a document that can leave the
 * shop by email or WhatsApp attachment instead of on paper — a wholesale
 * buyer's bookkeeper reconciling against it does not want a photograph of a
 * receipt.
 */

import { requireUser } from "@/lib/auth";
import { getCustomer, statement, balanceOf, renderStatementBlocks } from "@/lib/credit";
import { blocksToPdf, pdfCharsPerLine } from "@/lib/pdf";
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
  const customerId = Number(id);
  if (!Number.isInteger(customerId)) {
    return new Response("Not found.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const customer = getCustomer(customerId);
  if (!customer) {
    return new Response("Not found.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const blocks = renderStatementBlocks(customer, statement(customerId), balanceOf(customerId), pdfCharsPerLine());
  const bytes = blocksToPdf(blocks, printLogo());
  const name = customer.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || `customer-${customer.id}`;

  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="statement-${name}.pdf"`,
      "content-length": String(bytes.byteLength),
      "cache-control": "no-store",
    },
  });
}

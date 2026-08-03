"use client";

import { useRef, useState } from "react";
import { emailInvoiceAction } from "@/server/actions/email";
import type { PdfIssuer } from "@/lib/invoice-pdf";
import type { Invoice, InvoiceLine, Client } from "@/server/db/schema";

/**
 * Builds the invoice PDF in the browser (so the PDF library stays out of the
 * Cloudflare Worker) and posts it to the server action, which attaches it and
 * emails it to the client — no link, just the PDF file.
 */
export function EmailPdfButton({
  invoice,
  lines,
  client,
  issuer,
}: {
  invoice: Invoice;
  lines: InvoiceLine[];
  client: Client | null;
  issuer: PdfIssuer;
}) {
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { buildInvoicePdf, bytesToBase64 } = await import("@/lib/invoice-pdf");
      const bytes = await buildInvoicePdf(issuer, invoice, lines, client);
      if (pdfRef.current) pdfRef.current.value = bytesToBase64(bytes);
      formRef.current?.requestSubmit();
    } catch {
      setBusy(false);
      alert("Couldn't prepare the PDF. Please try again.");
    }
  }

  return (
    <form ref={formRef} action={emailInvoiceAction} className="inline">
      <input type="hidden" name="id" value={invoice.id} />
      <input type="hidden" name="pdf" ref={pdfRef} />
      <button type="button" onClick={onClick} disabled={busy} className="btn-ghost btn-sm">
        {busy ? "Preparing PDF…" : "Email PDF to client"}
      </button>
    </form>
  );
}

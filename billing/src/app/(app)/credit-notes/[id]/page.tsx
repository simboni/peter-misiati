import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { CreditNoteDocument } from "@/components/documents/templates";
import { deleteCreditNoteAction } from "@/server/actions/credit-notes";
import type { Metadata } from "next";

// "Save as PDF" → "Credit Note CN-0002.pdf" (absolute drops "· TallyPay").
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { db, organizationId } = await requireOrg();
  const rows = await db
    .select({ number: schema.creditNote.number })
    .from(schema.creditNote)
    .where(and(eq(schema.creditNote.id, id), eq(schema.creditNote.organizationId, organizationId)))
    .limit(1);
  return { title: { absolute: rows[0] ? `Credit Note ${rows[0].number}` : "Credit note" } };
}

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, organizationId } = await requireOrg();

  const rows = await db
    .select()
    .from(schema.creditNote)
    .where(and(eq(schema.creditNote.id, id), eq(schema.creditNote.organizationId, organizationId)))
    .limit(1);
  const cn = rows[0];
  if (!cn) notFound();

  const [lines, clientRows, org, profile, invRows] = await Promise.all([
    db
      .select()
      .from(schema.creditNoteLine)
      .where(eq(schema.creditNoteLine.creditNoteId, id))
      .orderBy(schema.creditNoteLine.sortOrder),
    db.select().from(schema.client).where(eq(schema.client.id, cn.clientId)).limit(1),
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
    cn.invoiceId
      ? db.select({ number: schema.invoice.number }).from(schema.invoice).where(eq(schema.invoice.id, cn.invoiceId)).limit(1)
      : Promise.resolve([]),
  ]);

  const issuer = { name: org?.name ?? "Business", profile };
  const invoiceNumber = invRows[0]?.number ?? null;

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">{cn.number}</h1>
        <div className="flex gap-2">
          <Link href={`/d/${cn.shareToken}`} target="_blank" className="btn-ghost btn-sm">View / Print</Link>
          <Link href={`/credit-notes/${cn.id}/edit`} className="btn-ghost btn-sm">Edit</Link>
          <form action={deleteCreditNoteAction}>
            <input type="hidden" name="id" value={cn.id} />
            <button className="btn-danger btn-sm">Delete</button>
          </form>
        </div>
      </div>

      <div className="card p-2 sm:p-4">
        <CreditNoteDocument issuer={issuer} creditNote={cn} lines={lines} client={clientRows[0] ?? null} invoiceNumber={invoiceNumber} />
      </div>
    </div>
  );
}

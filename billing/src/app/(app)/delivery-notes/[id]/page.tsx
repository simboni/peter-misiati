import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/server/org";
import { schema } from "@/server/db";
import { StatusBadge } from "@/components/status-badge";
import { formatQty } from "@/server/money";
import { fmtDate } from "@/server/queries";
import { deleteDeliveryNoteAction } from "@/server/actions/delivery-notes";
import type { Metadata } from "next";

// "Save as PDF" → "Delivery Note DN-0003.pdf" (absolute drops "· TallyPay").
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { db, organizationId } = await requireOrg();
  const rows = await db
    .select({ number: schema.deliveryNote.number })
    .from(schema.deliveryNote)
    .where(and(eq(schema.deliveryNote.id, id), eq(schema.deliveryNote.organizationId, organizationId)))
    .limit(1);
  return { title: { absolute: rows[0] ? `Delivery Note ${rows[0].number}` : "Delivery note" } };
}

export default async function DeliveryNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, organizationId } = await requireOrg();
  const rows = await db
    .select()
    .from(schema.deliveryNote)
    .where(and(eq(schema.deliveryNote.id, id), eq(schema.deliveryNote.organizationId, organizationId)))
    .limit(1);
  const note = rows[0];
  if (!note) notFound();

  const [lines, clientRows] = await Promise.all([
    db
      .select()
      .from(schema.deliveryNoteLine)
      .where(eq(schema.deliveryNoteLine.deliveryNoteId, id))
      .orderBy(schema.deliveryNoteLine.sortOrder),
    db.select().from(schema.client).where(eq(schema.client.id, note.clientId)).limit(1),
  ]);
  const client = clientRows[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-ink">{note.number}</h1>
          <StatusBadge status={note.status} />
        </div>
        <div className="flex gap-2">
          <Link href={`/d/${note.shareToken}`} target="_blank" className="btn-ghost btn-sm">
            View / Print
          </Link>
          <Link href={`/delivery-notes/${note.id}/edit`} className="btn-ghost btn-sm">
            Edit
          </Link>
          <form action={deleteDeliveryNoteAction}>
            <input type="hidden" name="id" value={note.id} />
            <button className="btn-danger btn-sm">Delete</button>
          </form>
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-4 flex flex-wrap justify-between gap-4 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Deliver to</p>
            <p className="mt-1 font-semibold text-ink">{client?.name ?? "—"}</p>
          </div>
          <p className="text-muted">
            Date: <span className="text-ink">{fmtDate(note.deliveryDate)}</span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Description</th>
                <th className="th text-right">Quantity</th>
                <th className="th">Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="td">{l.description}</td>
                  <td className="td text-right tabular-nums">{formatQty(l.quantityMilli)}</td>
                  <td className="td text-muted">{l.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {note.notes && <p className="mt-4 text-sm text-muted">{note.notes}</p>}
        {note.receivedBy && (
          <p className="mt-2 text-sm text-muted">Received by: {note.receivedBy}</p>
        )}
      </div>
    </div>
  );
}

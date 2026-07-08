export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { schema } from "@/server/db";
import { buildStatement } from "@/server/statement";
import { StatementDocument } from "@/components/documents/templates";
import { PrintBar } from "@/components/documents/print-bar";

export const metadata = { title: "Statement of account" };

export default async function ClientStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, organizationId } = await requireOrg();

  const rows = await db
    .select()
    .from(schema.client)
    .where(and(eq(schema.client.id, id), eq(schema.client.organizationId, organizationId)))
    .limit(1);
  const client = rows[0];
  if (!client) notFound();

  const [org, profile] = await Promise.all([getOrg(db, organizationId), getOrgProfile(db, organizationId)]);
  const currency = client.currency || profile?.currency || "KES";
  const statement = await buildStatement(db, organizationId, id, currency);
  const issuer = { name: org?.name ?? "Business", profile };

  return (
    <div>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/clients/${id}`} className="btn-ghost btn-sm">← Back to client</Link>
      </div>
      <PrintBar docLabel={`statement for ${client.name}`} clientEmail={client.email} clientPhone={client.phone} />
      <div className="p-4 print:p-0">
        <StatementDocument
          issuer={issuer}
          client={client}
          entries={statement.entries}
          totalDebit={statement.totalDebit}
          totalCredit={statement.totalCredit}
          closingBalance={statement.closingBalance}
          currency={statement.currency}
          asOf={new Date()}
        />
      </div>
    </div>
  );
}

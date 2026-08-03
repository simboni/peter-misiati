import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { receiptByRef, recentReceipts } from "@/server/milk";
import { EmptyState, PageTitle, Receipt } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * R6 — the receipt is persistent and re-viewable. The herdsman can show the
 * manager what he entered three hours ago by reading out a five-character code,
 * which is exactly how Kenyan users learned to trust mobile money.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const session = await verifySession();
  const receipt = await receiptByRef(session, ref);
  if (!receipt) notFound();

  const recent = await recentReceipts(session, receipt.kind);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <PageTitle sub={`Ref ${receipt.refCode}`}>Receipt</PageTitle>

      <Receipt title={receipt.summary} lines={receipt.lines} refCode={receipt.refCode}>
        <p className="mt-3 text-xs text-ink-3">
          {receipt.at.toLocaleString()}
          {receipt.actorName ? ` · by ${receipt.actorName}` : ""}
        </p>
      </Receipt>

      <p className="mt-4">
        <Link href="/milk" className="text-sm underline">
          Back to today&apos;s sheet
        </Link>
      </p>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold">Earlier</h2>
        {recent.length <= 1 ? (
          <EmptyState title="Nothing else recorded yet" />
        ) : (
          <ul className="space-y-2">
            {recent
              .filter((r) => r.refCode !== receipt.refCode)
              .map((r) => (
                <li key={r.refCode}>
                  <Link
                    href={`/milk/receipt/${r.refCode}`}
                    className="tap flex items-center justify-between rounded-lg border border-line bg-surface p-3 hover:border-brand"
                  >
                    <span>{r.summary}</span>
                    <span className="font-mono text-xs text-ink-3">{r.refCode}</span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>
    </main>
  );
}

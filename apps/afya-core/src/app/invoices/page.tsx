import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import { listInvoices, etimsQueue, etimsBacklog, formatKes } from "@/lib/billing.ts";
import { getFacility } from "@/lib/facility.ts";
import { Shell, Stat, Section, Empty, Banner, Views } from "@/app/_components/shell.tsx";
import { flushEtimsAction } from "./actions.ts";

/**
 * Invoices, and the tax queue behind them.
 *
 * Every encounter must end in a KRA-compliant invoice. The queue is on the same
 * screen because an untransmitted invoice is a tax compliance failure the
 * facility will not discover on its own — it looks exactly like a transmitted
 * one on the patient's slip.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "report.read") && !can(user.userId, "billing.charge")) redirect("/");

  const { view = "all", error } = await searchParams;
  const facility = getFacility(user.facilityId)!;
  const invoices = listInvoices(user.facilityId);
  const queue = etimsQueue();
  const backlog = etimsBacklog();

  const total = invoices.reduce((s, i) => s + i.total_cents, 0);
  const paid = invoices.reduce((s, i) => s + i.paid_cents, 0);
  const transmitted = invoices.filter((i) => i.etims_status === "sent").length;

  const statusTone: Record<string, string> = {
    issued: "text-clock",
    paid: "text-good",
    void: "text-muted line-through",
  };

  return (
    <Shell
      user={user}
      current={view === "etims" ? "/invoices?view=etims" : "/invoices"}
      error={error}
      title={view === "etims" ? "eTIMS queue" : "Invoices"}
      subtitle={
        view === "etims"
          ? "Every encounter must end in a KRA-compliant invoice."
          : `${invoices.length} issued · ${transmitted} transmitted to KRA`
      }
      actions={
        view === "etims" ? (
          <form action={flushEtimsAction}>
            <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
              Transmit what is queued
            </button>
          </form>
        ) : (
          <Link href="/payments" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
            Till
          </Link>
        )
      }
    >
      <Views
        current={view}
        views={[
          { key: "all", label: "All invoices", href: "/invoices" },
          { key: "etims", label: "eTIMS queue", href: "/invoices?view=etims" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Invoiced" value={formatKes(total)} note={`${invoices.length} invoices`} />
        <Stat label="Received" value={formatKes(paid)} tone="good" note={`${Math.round((paid / (total || 1)) * 100)}% of it`} />
        <Stat
          label="Awaiting KRA"
          value={backlog.queued}
          tone={backlog.queued > 10 ? "block" : backlog.queued > 0 ? "clock" : "good"}
          note={backlog.oldestQueuedAt ? `oldest ${backlog.oldestQueuedAt.slice(0, 10)}` : "nothing queued"}
        />
        <Stat
          label="KRA PIN"
          value={facility.kra_pin ? "On file" : "Missing"}
          tone={facility.kra_pin ? "good" : "block"}
          note={facility.kra_pin ?? "invoices cannot be issued"}
          href="/admin"
        />
      </div>

      {!facility.kra_pin ? (
        <div className="mt-5">
          <Banner tone="block">
            No KRA PIN is set, so nothing can be transmitted. Every encounter needs a compliant tax invoice.{" "}
            <Link href="/admin" className="underline underline-offset-2">Set it in administration.</Link>
          </Banner>
        </div>
      ) : null}

      {view === "etims" ? (
        <Section title="The queue" note="Queued, not sent. A failure keeps its reason and is tried again.">
          {queue.length === 0 ? (
            <Empty>Nothing has been queued for transmission.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Queued</th>
                    <th className="px-3 py-2 font-medium">Provisional number</th>
                    <th className="px-3 py-2 font-medium">Patient</th>
                    <th className="px-3 py-2 font-medium text-right">Amount</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">KRA number</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((q) => (
                    <tr key={q.id} className="border-t border-line">
                      <td className="px-3 py-2 tnum text-muted">{q.queued_at.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-3 py-2 font-mono text-xs tnum">{q.invoice_id}</td>
                      <td className="px-3 py-2 font-mono text-xs tnum">{q.patient_mrn}</td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(q.total_cents)}</td>
                      <td
                        className={`px-3 py-2 ${
                          q.status === "sent" ? "text-good" : q.status === "failed" ? "text-block" : "text-clock"
                        }`}
                      >
                        {q.status}
                        {q.attempts > 1 ? <span className="text-muted tnum"> · {q.attempts} attempts</span> : null}
                        {q.last_error ? <div className="text-xs text-block">{q.last_error}</div> : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tnum text-good">{q.canonical_number ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted mt-3 leading-relaxed">
            Two numbers are kept for every invoice, forever: the provisional one handed to the patient at the
            desk, and the canonical one KRA assigns on transmission. A gapless number cannot be minted offline,
            so it is never guessed.
          </p>
        </Section>
      ) : (
        <Section title="Issued">
          {invoices.length === 0 ? (
            <Empty>No invoice has been issued yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Issued</th>
                    <th className="px-3 py-2 font-medium">Number</th>
                    <th className="px-3 py-2 font-medium">Patient</th>
                    <th className="px-3 py-2 font-medium">Payer</th>
                    <th className="px-3 py-2 font-medium text-right">Total</th>
                    <th className="px-3 py-2 font-medium text-right">Received</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">KRA</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="px-3 py-2 tnum text-muted">{i.issued_at.slice(0, 10)}</td>
                      <td className="px-3 py-2 font-mono text-xs tnum">
                        <Link href={`/payments?invoice=${i.id}`} className="text-brand underline underline-offset-2">
                          {i.id}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{i.patient_name}</td>
                      <td className="px-3 py-2 text-muted">{i.payer_code}</td>
                      <td className="px-3 py-2 text-right tnum">{formatKes(i.total_cents)}</td>
                      <td className={`px-3 py-2 text-right tnum ${i.paid_cents > 0 ? "text-good" : "text-muted"}`}>
                        {i.paid_cents > 0 ? formatKes(i.paid_cents) : "—"}
                      </td>
                      <td className={`px-3 py-2 ${statusTone[i.status]}`}>{i.status}</td>
                      <td
                        className={`px-3 py-2 font-mono text-xs tnum ${
                          i.etims_number ? "text-good" : "text-clock"
                        }`}
                      >
                        {i.etims_number ?? i.etims_status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </Shell>
  );
}

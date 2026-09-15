import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import { auditLog, auditActions, verifyAuditChain } from "@/lib/db.ts";
import { listUsers } from "@/lib/users.ts";
import { Shell, Stat, Section, Empty, Banner } from "@/app/_components/shell.tsx";

const PURPOSES = ["treatment", "billing", "claim", "audit", "support", "administration"];
const PAGE = 60;

/**
 * The audit log.
 *
 * It has been written since the first commit and had no screen. An audit trail
 * nobody can read is a compliance claim, not a compliance control: the ODPC
 * asks who opened a record, and the facility has to be able to answer without
 * an engineer and a database client.
 *
 * The chain verification at the top is the part that matters. Every row stores
 * the digest of the row before it, so an edited or deleted entry breaks the
 * chain and this says where — which is what makes the log evidence rather than
 * a list somebody could have typed.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string; actor?: string; purpose?: string; q?: string;
    from?: string; to?: string; page?: string; error?: string;
  }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "audit.read")) redirect("/");

  const p = await searchParams;
  const page = Math.max(0, Number(p.page ?? 0) || 0);

  const filter = {
    action: p.action || undefined,
    actorId: p.actor ? Number(p.actor) : undefined,
    purpose: p.purpose || undefined,
    search: p.q || undefined,
    from: p.from || undefined,
    to: p.to || undefined,
  };

  const rows = auditLog(filter, PAGE + 1, page * PAGE);
  const hasMore = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const actions = auditActions();
  const staff = listUsers(user.facilityId);
  const chain = verifyAuditChain();

  const query = (overrides: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...p, ...overrides })) {
      if (v !== undefined && v !== "" && k !== "error") next.set(k, String(v));
    }
    const s = next.toString();
    return s ? `/audit?${s}` : "/audit";
  };

  // Reads of patient data are the ones a data-protection audit asks about.
  const disclosures = shown.filter((r) => r.patient_id && /read|opened|disclos/i.test(r.action)).length;

  return (
    <Shell
      user={user}
      current="/audit"
      error={p.error}
      title="Audit log"
      subtitle="Every write, and every read of a patient's record."
      actions={
        <Link href="/admin" className="border border-line font-semibold rounded px-4 py-2 text-sm">
          Administration
        </Link>
      }
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Chain"
          value={chain.ok ? "Intact" : "Broken"}
          tone={chain.ok ? "good" : "block"}
          note={chain.ok ? `${chain.checked} entries verified` : `breaks at entry #${chain.failedAtId}`}
        />
        <Stat label="Entries" value={chain.checked} note="since the system was installed" tone="muted" />
        <Stat label="Distinct actions" value={actions.length} note="kinds of event recorded" tone="muted" />
        <Stat
          label="Disclosures on this page"
          value={disclosures}
          note="reads of an identifiable record"
          tone={disclosures > 0 ? "clock" : "muted"}
        />
      </div>

      {!chain.ok ? (
        <div className="mt-5">
          <Banner tone="block">
            The hash chain is broken at entry #{chain.failedAtId} ({chain.reason.replace(/-/g, " ")}). Every row
            carries the digest of the one before it, so this means the log was altered after the fact. Treat
            everything after that entry as unverified and raise it immediately.
          </Banner>
        </div>
      ) : null}

      <Section title="Filter">
        <form className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Action
            <select name="action" defaultValue={p.action ?? ""} className="block w-52 border border-line rounded px-2 py-1.5 text-sm bg-white">
              <option value="">Everything</option>
              {actions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.action.replace(/_/g, " ")} ({a.n})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Who
            <select name="actor" defaultValue={p.actor ?? ""} className="block w-44 border border-line rounded px-2 py-1.5 text-sm bg-white">
              <option value="">Anyone</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Purpose
            <select name="purpose" defaultValue={p.purpose ?? ""} className="block border border-line rounded px-2 py-1.5 text-sm bg-white">
              <option value="">Any</option>
              {PURPOSES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            From
            <input name="from" type="date" defaultValue={p.from ?? ""} className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
          </label>
          <label className="text-xs text-muted">
            To
            <input name="to" type="date" defaultValue={p.to ?? ""} className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
          </label>
          <label className="text-xs text-muted flex-1 min-w-[10rem]">
            Name, file number or record
            <input name="q" defaultValue={p.q ?? ""} className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white" />
          </label>
          <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
            Show
          </button>
          <Link href="/audit" className="border border-line font-semibold rounded px-3 py-2 text-sm">
            Clear
          </Link>
        </form>
      </Section>

      <Section title={`Entries ${page * PAGE + 1}–${page * PAGE + shown.length}`}>
        {shown.length === 0 ? (
          <Empty>Nothing matches that filter.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white border border-line rounded">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Who</th>
                  <th className="px-3 py-2 font-medium">Did what</th>
                  <th className="px-3 py-2 font-medium">To</th>
                  <th className="px-3 py-2 font-medium">Patient</th>
                  <th className="px-3 py-2 font-medium">Why</th>
                  <th className="px-3 py-2 font-medium">Device</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-3 py-1.5 tnum text-muted whitespace-nowrap">
                      {r.at.slice(0, 19).replace("T", " ")}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.actor_name}</td>
                    <td className="px-3 py-1.5 font-medium">{r.action.replace(/_/g, " ")}</td>
                    <td className="px-3 py-1.5 text-muted">
                      {r.entity}
                      {r.entity_id ? <span className="font-mono text-xs"> {r.entity_id}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs tnum">
                      {r.patient_id ? (
                        <Link
                          href={`/patients/${encodeURIComponent(r.patient_id)}`}
                          className="text-brand underline underline-offset-2"
                        >
                          {r.patient_id}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted">{r.purpose}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted">{r.device_code ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          {page > 0 ? (
            <Link href={query({ page: page - 1 })} className="border border-line font-semibold rounded px-4 py-2 text-sm">
              ← Newer
            </Link>
          ) : null}
          {hasMore ? (
            <Link href={query({ page: page + 1 })} className="border border-line font-semibold rounded px-4 py-2 text-sm">
              Older →
            </Link>
          ) : null}
        </div>

        <p className="text-xs text-muted mt-3 leading-relaxed">
          Reads are logged as well as writes, each with a purpose of use. This is what a patient is entitled
          to see when they ask who has opened their record, and what the ODPC asks a data controller to
          produce.
        </p>
      </Section>
    </Shell>
  );
}

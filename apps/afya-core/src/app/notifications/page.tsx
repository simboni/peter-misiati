import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { inbox } from "@/lib/notifications.ts";
import { rolesForUser } from "@/lib/access.ts";
import { unacknowledged } from "@/lib/orders.ts";
import { Shell, Stat, Section, Empty } from "@/app/_components/shell.tsx";
import { actOnAction, sweepAction, acknowledgeAction } from "./actions.ts";

/**
 * Alerts.
 *
 * Every notification names the role that can act on it, so this shows what is
 * on THIS person's desk first and the rest of the facility's below. A list
 * where everything is everybody's is a list nobody works.
 */
export default async function NotificationsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const all = inbox(user.facilityId);
  const mine = new Set(rolesForUser(user.userId));
  const forMe = all.filter((n) => mine.has(n.owner_role));
  const others = all.filter((n) => !mine.has(n.owner_role));
  const results = unacknowledged();

  const tone = {
    critical: "bg-block-soft border-block/25",
    warning: "bg-clock-soft border-clock/25",
    info: "bg-white border-line",
  } as const;

  const text = { critical: "text-block", warning: "text-clock", info: "text-ink" } as const;

  const list = (rows: typeof all) => (
    <ul className="flex flex-col gap-2">
      {rows.map((n) => (
        <li key={n.id} className={`border rounded px-4 py-3 ${tone[n.severity]}`}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`text-sm font-semibold ${text[n.severity]}`}>{n.subject}</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted ml-auto">
              {n.owner_role.replace("_", " ")}
            </span>
          </div>
          {n.body ? <p className="text-xs text-muted mt-1 leading-relaxed">{n.body}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {n.entity === "claim" && n.entity_id ? (
              <Link href="/claims" className="text-xs text-brand underline underline-offset-2">
                Open the claim
              </Link>
            ) : null}
            {n.entity === "order" ? (
              <Link href="/laboratory" className="text-xs text-brand underline underline-offset-2">
                Open the laboratory
              </Link>
            ) : null}
            {n.entity === "admission" ? (
              <Link href="/ward" className="text-xs text-brand underline underline-offset-2">
                Open the ward
              </Link>
            ) : null}
            {n.entity === "integration" ? (
              <Link href="/admin" className="text-xs text-brand underline underline-offset-2">
                Open integrations
              </Link>
            ) : null}
            <span className="text-xs text-muted tnum ml-auto">
              {n.updated_at.slice(0, 16).replace("T", " ")}
            </span>
            <form action={actOnAction}>
              <input type="hidden" name="id" value={n.id} />
              <button type="submit" className="text-xs font-semibold border border-line bg-white rounded px-3 py-1.5">
                Done
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <Shell
      user={user}
      current="/notifications"
      title="Alerts"
      subtitle="Everything with a clock on it, on the desk that can act."
      actions={
        <form action={sweepAction}>
          <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
            Check everything now
          </button>
        </form>
      }
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="On your desk" value={forMe.length} tone={forMe.length > 0 ? "clock" : "good"} />
        <Stat
          label="Critical"
          value={all.filter((n) => n.severity === "critical").length}
          tone={all.some((n) => n.severity === "critical") ? "block" : "good"}
        />
        <Stat label="Elsewhere in the facility" value={others.length} tone="muted" />
        <Stat
          label="Results unread"
          value={results.length}
          tone={results.some((r) => r.panic) ? "block" : results.length > 0 ? "clock" : "good"}
          href="/laboratory"
        />
      </div>

      <Section title="Yours">
        {forMe.length === 0 ? <Empty>Nothing needs you.</Empty> : list(forMe)}
      </Section>

      {results.length > 0 ? (
        <Section
          title="Results waiting to be read"
          note="A released result is outstanding until a clinician says they have seen it."
        >
          <ul className="flex flex-col gap-2">
            {results.map((u) => (
              <li
                key={u.order.id}
                className={`border rounded px-4 py-3 ${
                  u.panic ? "bg-block-soft border-block/25" : u.abnormal ? "bg-clock-soft border-clock/25" : "bg-white border-line"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {u.panic ? (
                    <span className="text-[11px] font-bold uppercase tracking-wide bg-block text-white rounded px-1.5 py-0.5">
                      Critical
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold">{u.order.service_name}</span>
                  <Link
                    href={`/patients/${encodeURIComponent(u.order.patient_mrn)}`}
                    className="text-sm underline underline-offset-2"
                  >
                    {u.patientName}
                  </Link>
                  <span className="text-xs text-muted ml-auto tnum">waiting {u.hoursWaiting}h</span>
                </div>
                <form action={acknowledgeAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="orderId" value={u.order.id} />
                  <input
                    name="action"
                    placeholder="What are you doing about it?"
                    className="flex-1 min-w-[14rem] border border-line rounded px-2 py-1.5 text-sm bg-white"
                  />
                  <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                    Acknowledge
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {others.length > 0 ? (
        <Section title="Elsewhere in the facility" note="Shown so nothing is invisible, not because it is yours.">
          {list(others)}
        </Section>
      ) : null}
    </Shell>
  );
}

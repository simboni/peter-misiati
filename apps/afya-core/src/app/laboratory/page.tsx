import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { check, explain } from "@/lib/access.ts";
import { pendingOrders, unacknowledged, turnaround } from "@/lib/orders.ts";
import { specimensFor, resultsFor, formatValue } from "@/lib/laboratory.ts";
import { Shell, Stat, Section, Empty, Banner, Views } from "@/app/_components/shell.tsx";
import { collectAction, rejectAction, enterResultAction, releaseAction } from "./actions.ts";

/**
 * The laboratory bench.
 *
 * One screen because the work is one sequence: collect, read, release. The
 * release button is the only place a reading becomes a result, and it is
 * licence-gated — so if this user cannot release, the screen says so at the top
 * rather than failing at the last click.
 */
export default async function LaboratoryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; error?: string }>;
}) {
  const { view = "bench", error } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const pending = pendingOrders("lab");
  const outstanding = unacknowledged();
  const canRelease = check(user.userId, "lab.result.release");
  const times = turnaround("lab");

  const flagTone: Record<string, string> = {
    normal: "text-ink",
    low: "text-clock",
    high: "text-clock",
    abnormal: "text-clock",
    panic_low: "text-block font-bold",
    panic_high: "text-block font-bold",
  };

  return (
    <Shell
      user={user}
      current={view === "unread" ? "/laboratory?view=unread" : "/laboratory"}
      error={error}
      title={view === "unread" ? "Results to acknowledge" : "Laboratory"}
      subtitle="Collect, read, release. Nothing reaches a clinician until it is released."
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="On the bench" value={pending.length} note="orders in progress" />
        <Stat
          label="Stat"
          value={pending.filter((o) => o.priority === "stat").length}
          tone={pending.some((o) => o.priority === "stat") ? "block" : "good"}
          note="somebody's next five minutes"
        />
        <Stat
          label="Reported, unread"
          value={outstanding.length}
          tone={outstanding.some((u) => u.panic) ? "block" : outstanding.length > 0 ? "clock" : "good"}
          note={`${outstanding.filter((u) => u.panic).length} critical`}
        />
        <Stat
          label="Median turnaround"
          value={times.length ? `${times[0].medianHours}h` : "—"}
          note={times.length ? times[0].serviceName : "nothing reported yet"}
          tone="muted"
        />
      </div>

      {!canRelease.allowed ? (
        <div className="mt-5">
          <Banner tone="clock">
            {explain(canRelease)} You can enter readings; releasing them is what turns a reading into a
            result, and it needs a KMLTTB registration.
          </Banner>
        </div>
      ) : null}

      <Views
        current={view}
        views={[
          { key: "bench", label: "On the bench", href: "/laboratory" },
          { key: "unread", label: "Results to acknowledge", href: "/laboratory?view=unread" },
        ]}
      />

      {view === "bench" ? (
      <Section title="On the bench" note="Stat first, then urgent, then oldest.">
        {pending.length === 0 ? (
          <Empty>Nothing waiting. Orders appear here as clinicians place them.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((order) => {
              const specimens = specimensFor(order.id);
              const live = specimens.filter((s) => !s.rejected_at);
              const results = resultsFor(order.id);
              const unreleased = results.filter((r) => !r.released_at);

              return (
                <li
                  key={order.id}
                  className={`bg-white border rounded px-4 py-3 ${
                    order.priority === "stat"
                      ? "border-block/40"
                      : order.priority === "urgent"
                        ? "border-clock/40"
                        : "border-line"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {order.priority !== "routine" ? (
                      <span
                        className={`text-[11px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                          order.priority === "stat"
                            ? "bg-block text-white"
                            : "bg-clock-soft text-clock"
                        }`}
                      >
                        {order.priority}
                      </span>
                    ) : null}
                    <span className="font-semibold">{order.service_name}</span>
                    <Link
                      href={`/patients/${encodeURIComponent(order.patient_mrn)}`}
                      className="text-sm underline underline-offset-2"
                    >
                      {order.patient_name}
                    </Link>
                    <span className="font-mono text-xs text-muted tnum">{order.patient_mrn}</span>
                    <span className="text-xs text-muted ml-auto tnum">
                      {order.orderer_name} · {order.created_at.slice(0, 16).replace("T", " ")}
                    </span>
                  </div>

                  {order.clinical_question ? (
                    <p className="text-xs text-muted mt-1">
                      Asked: {order.clinical_question}
                    </p>
                  ) : null}

                  {/* ---- 1. collect ---- */}
                  {live.length === 0 ? (
                    <form action={collectAction} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="orderId" value={order.id} />
                      <label className="text-xs text-muted">
                        Specimen
                        <input
                          name="kind"
                          defaultValue="EDTA whole blood"
                          className="block w-52 border border-line rounded px-2 py-1.5 text-sm bg-white"
                        />
                      </label>
                      <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                        Record collection
                      </button>
                      {specimens.length > 0 ? (
                        <span className="text-xs text-block">
                          Previous specimen rejected: {specimens.at(-1)!.rejection_reason}
                        </span>
                      ) : null}
                    </form>
                  ) : (
                    <>
                      <p className="text-xs text-muted mt-2 tnum">
                        {live[0].kind} collected {live[0].collected_at.slice(0, 16).replace("T", " ")} by{" "}
                        {live[0].collector_name}
                      </p>

                      {/* ---- 2. read ---- */}
                      {results.length > 0 ? (
                        <table className="w-full text-sm mt-2">
                          <tbody>
                            {results.map((r) => (
                              <tr key={r.id} className="border-t border-line">
                                <td className="py-1.5 pr-3 font-medium">{r.analyte}</td>
                                <td className={`py-1.5 pr-3 tnum ${flagTone[r.flag]}`}>
                                  {r.value_milli === null ? r.value_text : formatValue(r.value_milli, r.unit)}
                                  {r.flag !== "normal" ? ` (${r.flag.replace("_", " ")})` : ""}
                                </td>
                                <td className="py-1.5 text-xs text-muted tnum text-right">
                                  {r.low_milli !== null && r.high_milli !== null
                                    ? `ref ${formatValue(r.low_milli)}–${formatValue(r.high_milli)}`
                                    : ""}
                                </td>
                                <td className="py-1.5 pl-3 text-xs text-right">
                                  {r.released_at ? (
                                    <span className="text-good">released</span>
                                  ) : (
                                    <span className="text-muted">not released</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}

                      <form action={enterResultAction} className="mt-3 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="orderId" value={order.id} />
                        <label className="text-xs text-muted">
                          Analyte
                          <input
                            name="analyte"
                            placeholder="HB"
                            required
                            className="block w-28 border border-line rounded px-2 py-1.5 text-sm uppercase bg-white"
                          />
                        </label>
                        <label className="text-xs text-muted">
                          Value
                          <input
                            name="value"
                            type="number"
                            step="0.001"
                            className="block w-28 border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
                          />
                        </label>
                        <label className="text-xs text-muted">
                          or text
                          <input
                            name="valueText"
                            placeholder="Positive"
                            className="block w-36 border border-line rounded px-2 py-1.5 text-sm bg-white"
                          />
                        </label>
                        <label className="text-xs text-muted">
                          Unit
                          <input
                            name="unit"
                            placeholder="from range"
                            className="block w-28 border border-line rounded px-2 py-1.5 text-sm bg-white"
                          />
                        </label>
                        <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
                          Add reading
                        </button>
                      </form>

                      {/* ---- 3. release ---- */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {unreleased.length > 0 && canRelease.allowed ? (
                          <form action={releaseAction}>
                            <input type="hidden" name="orderId" value={order.id} />
                            <button type="submit" className="bg-good text-white font-semibold rounded px-4 py-2 text-sm">
                              Release {unreleased.length} result{unreleased.length === 1 ? "" : "s"}
                            </button>
                          </form>
                        ) : null}

                        <form action={rejectAction} className="flex items-end gap-2">
                          <input type="hidden" name="specimenId" value={live[0].id} />
                          <input
                            name="reason"
                            placeholder="Reject the specimen — why?"
                            required
                            className="w-56 border border-line rounded px-2 py-1.5 text-sm bg-white"
                          />
                          <button type="submit" className="border border-block text-block font-semibold rounded px-3 py-2 text-sm">
                            Reject
                          </button>
                        </form>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      ) : null}

      <Section
        title="Reported and not read"
        note="A result nobody read is the failure this list exists to make visible. Critical first."
      >
        {outstanding.length === 0 ? (
          <Empty>Every released result has been acknowledged.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {outstanding.map((u) => (
              <li
                key={u.order.id}
                className={`border rounded px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${
                  u.panic
                    ? "bg-block-soft border-block/25"
                    : u.abnormal
                      ? "bg-clock-soft border-clock/25"
                      : "bg-white border-line"
                }`}
              >
                {u.panic ? (
                  <span className="text-[11px] font-bold uppercase tracking-wide bg-block text-white rounded px-1.5 py-0.5">
                    Critical
                  </span>
                ) : null}
                <span className="font-medium text-sm">{u.order.service_name}</span>
                <Link
                  href={`/patients/${encodeURIComponent(u.order.patient_mrn)}`}
                  className="text-sm underline underline-offset-2"
                >
                  {u.patientName}
                </Link>
                <span className="text-xs text-muted ml-auto tnum">
                  waiting {u.hoursWaiting}h for {u.order.orderer_name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Shell>
  );
}

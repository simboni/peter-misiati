import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { dayList, availability, attendance } from "@/lib/scheduling.ts";
import { listUsers } from "@/lib/users.ts";
import { searchPatients } from "@/lib/patients.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty } from "@/app/_components/shell.tsx";
import { openClinicAction, bookAction, cancelAction, arriveAction, remindAction, closeOutAction } from "./actions.ts";

/**
 * Appointments.
 *
 * One day at a time, because that is how a front desk works. The no-show rate
 * sits at the top rather than in a report nobody opens: a patient who does not
 * come is a slot that earned nothing and a follow-up that did not happen.
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; q?: string; slot?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const params = await searchParams;
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today();

  const list = dayList({ facilityId: user.facilityId, date });
  const free = availability({ facilityId: user.facilityId, date });
  const providers = listUsers(user.facilityId).filter((u) => u.active);
  const candidates = params.q?.trim()
    ? searchPatients({ facilityId: user.facilityId, query: params.q, limit: 6 })
    : [];

  const monthStart = `${date.slice(0, 7)}-01`;
  const stats = attendance({ facilityId: user.facilityId, from: monthStart, to: date });

  const shift = (days: number) =>
    new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

  const statusTone: Record<string, string> = {
    booked: "text-ink",
    arrived: "text-good",
    completed: "text-good",
    did_not_attend: "text-block",
    cancelled: "text-muted",
  };

  return (
    <Shell
      user={user}
      current="/appointments"
      title="Appointments"
      subtitle={date === today() ? "Today" : date}
      actions={
        <>
          <a href={`/appointments?date=${shift(-1)}`} className="border border-line font-semibold rounded px-3 py-2 text-sm">
            ←
          </a>
          <a href={`/appointments?date=${today()}`} className="border border-line font-semibold rounded px-3 py-2 text-sm">
            Today
          </a>
          <a href={`/appointments?date=${shift(1)}`} className="border border-line font-semibold rounded px-3 py-2 text-sm">
            →
          </a>
        </>
      }
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Booked" value={list.length} note={`${date}`} />
        <Stat label="Slots free" value={free.length} tone={free.length === 0 ? "clock" : "good"} />
        <Stat
          label="No-show rate"
          value={stats.noShowRatePercent === null ? "—" : `${stats.noShowRatePercent}%`}
          tone={
            stats.noShowRatePercent === null ? "muted" : stats.noShowRatePercent > 20 ? "block" : "good"
          }
          note="this month"
        />
        <Stat
          label="Utilisation"
          value={stats.utilisationPercent === null ? "—" : `${stats.utilisationPercent}%`}
          tone="muted"
          note="of the slots opened"
        />
      </div>

      <Section title={`Booked on ${date}`}>
        {list.length === 0 ? (
          <Empty>Nothing booked. Open a clinic below, then book into it.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((a) => (
              <li key={a.id} className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-2">
                <span className="font-mono text-sm font-bold tnum w-12">{a.start_time}</span>
                <Link
                  href={`/patients/${encodeURIComponent(a.patient_mrn)}`}
                  className="font-medium underline underline-offset-2"
                >
                  {a.patient_name}
                </Link>
                <span className="text-xs text-muted">{a.provider_name}</span>
                {a.reason ? <span className="text-xs text-muted">· {a.reason}</span> : null}
                <span className={`text-xs font-medium ml-auto ${statusTone[a.status]}`}>
                  {a.status.replace(/_/g, " ")}
                </span>

                {a.status === "booked" ? (
                  <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                    <form action={arriveAction}>
                      <input type="hidden" name="appointmentId" value={a.id} />
                      <input type="hidden" name="mrn" value={a.patient_mrn} />
                      <button type="submit" className="bg-brand text-white font-semibold rounded px-3 py-1.5 text-xs">
                        Arrived — check in
                      </button>
                    </form>
                    <form action={cancelAction} className="flex gap-1">
                      <input type="hidden" name="appointmentId" value={a.id} />
                      <input
                        name="reason"
                        required
                        placeholder="Cancel — why?"
                        className="w-40 border border-line rounded px-2 py-1.5 text-xs bg-white"
                      />
                      <button type="submit" className="border border-line font-semibold rounded px-3 py-1.5 text-xs">
                        Cancel
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <form action={remindAction}>
            <input type="hidden" name="date" value={date} />
            <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
              Send reminders for {date}
            </button>
          </form>
          <form action={closeOutAction}>
            <input type="hidden" name="date" value={date} />
            <button type="submit" className="border border-line font-semibold rounded px-4 py-2 text-sm">
              Close out the day
            </button>
          </form>
        </div>
      </Section>

      <Section title="Book into a free slot">
        <form className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="date" value={date} />
          <label className="text-xs text-muted flex-1 min-w-[14rem]">
            Find the patient
            <input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Name, file number or national ID"
              className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white"
            />
          </label>
          <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2 text-sm">
            Search
          </button>
        </form>

        {free.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No free slots on {date}.</p>
        ) : candidates.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            {free.length} slot{free.length === 1 ? "" : "s"} free
            {free[0] ? ` from ${free[0].start_time}` : ""}. Find a patient to book one.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {candidates.map((p) => (
              <li key={p.mrn} className="bg-white border border-line rounded px-4 py-3">
                <form action={bookAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="mrn" value={p.mrn} />
                  <div className="min-w-[10rem]">
                    <div className="font-medium text-sm">
                      {p.given_name} {p.family_name}
                    </div>
                    <div className="font-mono text-xs text-muted tnum">{p.mrn}</div>
                  </div>
                  <label className="text-xs text-muted">
                    Slot
                    <select name="slotId" className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white">
                      {free.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.start_time} — {s.providerName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-muted flex-1 min-w-[10rem]">
                    Reason
                    <input name="reason" className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white" />
                  </label>
                  <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                    Book
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Open a clinic" note="Slots are laid out individually, so cancelling one morning is one morning.">
        <form action={openClinicAction} className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Clinician
            <select name="providerId" className="block border border-line rounded px-2 py-1.5 text-sm bg-white">
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Date
            <input
              name="date"
              type="date"
              defaultValue={date}
              className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
            />
          </label>
          <label className="text-xs text-muted">
            From
            <input name="from" type="time" defaultValue="09:00" className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
          </label>
          <label className="text-xs text-muted">
            To
            <input name="to" type="time" defaultValue="13:00" className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
          </label>
          <label className="text-xs text-muted">
            Minutes each
            <input
              name="minutes"
              type="number"
              min={5}
              defaultValue={15}
              className="block w-24 border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
            />
          </label>
          <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
            Open
          </button>
        </form>
      </Section>
    </Shell>
  );
}

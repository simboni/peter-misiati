import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  register, mortuarySummary, occupancy, unclaimed, listBodies,
  getBody, eventsFor, releaseCheck, storageFee, daysInStore,
  freeDays, dailyFeeCents, unclaimedDays,
} from "@/lib/mortuary.ts";
import { listAssets } from "@/lib/assets.ts";
import { formatKes } from "@/lib/billing.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  receiveAction, viewingAction, postmortemAction, waivePostmortemAction,
  notificationAction, releaseAction, unitAction,
} from "./actions.ts";

/**
 * The mortuary register.
 *
 * The screen leads with what is holding each body up, because that is the
 * question an attendant is asked at the counter twenty times a day and the one
 * a grieving family cannot get a straight answer to anywhere else.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

const SOURCE_LABEL: Record<string, string> = {
  ward: "Ward",
  casualty: "Casualty",
  theatre: "Theatre",
  maternity: "Maternity",
  brought_in: "Brought in",
  transferred_in: "Transferred in",
};

const IDENTITY_LABEL: Record<string, string> = {
  confirmed: "identified",
  provisional: "name given, not confirmed",
  unknown: "unidentified",
};

export default async function MortuaryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; b?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "patient.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "register";
  const configuring = can(user.userId, "facility.configure");

  const summary = mortuarySummary(user.facilityId);
  const rows = register(user.facilityId);
  const units = occupancy(user.facilityId);
  const stale = unclaimed(user.facilityId);
  const released = listBodies(user.facilityId, "released");
  const fridges = listAssets(user.facilityId).filter((a) => a.category === "cold_chain");

  const open = params.b ? getBody(params.b) : undefined;
  const openEvents = open ? eventsFor(open.id) : [];
  const openCheck = open ? releaseCheck(open.id) : undefined;
  const openFee = open ? storageFee(open) : undefined;
  // Read through the configuration studio, so the screen quotes what the rule
  // actually uses.
  const free = freeDays();
  const perDay = dailyFeeCents();
  const unclaimedAfter = unclaimedDays();

  return (
    <Shell
      user={user}
      current="/mortuary"
      error={params.error}
      title={
        open ? `Body ${open.tag_no}`
        : view === "released" ? "Released"
        : view === "unclaimed" ? "Unclaimed"
        : view === "units" ? "Cold rooms"
        : "Mortuary register"
      }
      subtitle={
        view === "register" && !open
          ? "A body is its tag, not its name. What is holding each one up is in the last column."
          : undefined
      }
    >
      <Views
        current={open ? "register" : view}
        views={[
          { key: "register", label: "In store", href: "/mortuary" },
          { key: "unclaimed", label: "Unclaimed", href: "/mortuary?view=unclaimed" },
          { key: "released", label: "Released", href: "/mortuary?view=released" },
          { key: "units", label: "Cold rooms", href: "/mortuary?view=units" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="In store"
          value={summary.inStore}
          note={`${summary.free} of ${summary.bays} bays free`}
          tone={summary.free === 0 ? "block" : "ink"}
        />
        <Stat
          label="Unidentified"
          value={summary.unidentified}
          tone={summary.unidentified > 0 ? "clock" : "good"}
          note={`${summary.medicoLegal} police case${summary.medicoLegal === 1 ? "" : "s"}`}
        />
        <Stat
          label="Not releasable"
          value={summary.blocked}
          tone={summary.blocked > 0 ? "block" : "good"}
          note={`${summary.awaitingPostmortem} awaiting a postmortem`}
        />
        <Stat
          label="Longest stay"
          value={`${summary.longestDays}d`}
          tone={summary.unclaimed > 0 ? "block" : "ink"}
          note={`${summary.unclaimed} past ${unclaimedAfter} days · ${formatKes(summary.accruedFeeCents)} accrued`}
        />
      </div>

      {summary.releasedWithoutNotification > 0 ? (
        <p className="mt-4 text-xs bg-white border border-line rounded px-3 py-2 text-muted">
          {summary.releasedWithoutNotification} release
          {summary.releasedWithoutNotification === 1 ? " went" : "s went"} ahead without a death notification
          reference, each on a written reason. That is allowed and it is never silent.
        </p>
      ) : null}

      {/* ================================================== one body */}
      {open ? (
        <>
          <Section title={`${open.tag_no} · ${[open.given_name, open.family_name].filter(Boolean).join(" ") || "unidentified"}`}>
            <div className="bg-white border border-line rounded p-3 text-sm">
              <p className="text-muted">
                {SOURCE_LABEL[open.source]}
                {open.place_of_death ? ` · ${open.place_of_death}` : ""}
                {open.sex && open.sex !== "unknown" ? ` · ${open.sex}` : ""}
                {open.age_years ? ` · ${open.age_years} years` : ""}
                {open.patient_mrn ? ` · patient ${open.patient_mrn}` : ""}
              </p>
              <p className="mt-2">
                <span className={open.identity === "confirmed" ? "text-good" : "text-block"}>
                  {IDENTITY_LABEL[open.identity]}
                </span>
                <span className="text-muted">
                  {" "}· received {open.received_at.slice(0, 16).replace("T", " ")} · {daysInStore(open)} day
                  {daysInStore(open) === 1 ? "" : "s"} in store
                </span>
              </p>
              {open.medico_legal ? (
                <p className="mt-1 text-block">
                  Police case {open.police_ob_no}
                  {open.investigating_officer ? ` · ${open.investigating_officer}` : ""}
                </p>
              ) : null}
              {open.cause_of_death ? (
                <p className="mt-1">
                  Cause: {open.cause_of_death}
                  {open.certified_by ? <span className="text-muted"> — certified by {open.certified_by}</span> : null}
                </p>
              ) : null}
              <p className="text-xs text-muted mt-2">
                {openFee!.days} days · {openFee!.chargeableDays} chargeable after {free} free ·{" "}
                {formatKes(openFee!.feeCents)}
                {open.notification_ref ? ` · notification ${open.notification_ref}` : " · no death notification yet"}
              </p>
              <p className="mt-2">
                <Link href="/mortuary" className="text-brand text-sm hover:underline">← the register</Link>
              </p>
            </div>
          </Section>

          {open.status === "in_store" ? (
            <Section title="What is holding this body up">
              {openCheck!.ok ? (
                <p className="bg-white border border-line rounded px-3 py-2 text-sm text-good">
                  Nothing. This body may be released.
                </p>
              ) : (
                <div className="bg-white border border-line rounded p-3 text-sm space-y-1">
                  {openCheck!.blockers.map((reason) => (
                    <p key={reason} className="text-block">■ {reason}</p>
                  ))}
                  {openCheck!.overridable.map((reason) => (
                    <p key={reason} className="text-clock">▲ {reason} — releasable on a written reason</p>
                  ))}
                </div>
              )}
            </Section>
          ) : (
            <Section title="Released">
              <div className="bg-white border border-line rounded p-3 text-sm">
                <p>
                  To {open.released_to_name} ({open.released_to_relationship}), ID {open.released_to_id}, on{" "}
                  {open.released_at?.slice(0, 16).replace("T", " ")}
                </p>
                {open.release_authority ? (
                  <p className="text-muted mt-1">Authority: {open.release_authority}</p>
                ) : null}
                {open.release_override ? (
                  <p className="text-clock mt-1">Released without a notification reference: {open.release_override}</p>
                ) : null}
                <p className="text-muted mt-1">
                  {formatKes(open.fee_cents)} charged · {formatKes(open.paid_cents)} paid
                  {open.waived_cents > 0 ? ` · ${formatKes(open.waived_cents)} waived (${open.waiver_reason})` : ""}
                </p>
              </div>
            </Section>
          )}

          {open.status === "in_store" ? (
            <>
              <Section
                title="Viewing and identification"
                note="Who identified the body, on what document, and how they knew them. If it turns out to be the wrong body, those three facts are the whole investigation."
              >
                <form action={viewingAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="bodyId" value={open.id} />
                  <div>
                    <label className={LABEL}>Who viewed</label>
                    <input name="personName" required className={FIELD} placeholder="Mary Mwangi" />
                  </div>
                  <div>
                    <label className={LABEL}>Their ID number</label>
                    <input name="personId" className={FIELD} placeholder="12345678" />
                  </div>
                  <div>
                    <label className={LABEL}>Relationship</label>
                    <input name="relationship" className={FIELD} placeholder="sister" />
                  </div>
                  <div>
                    <label className={LABEL}>Outcome</label>
                    <select name="identified" className={FIELD}>
                      <option value="yes">Identified</option>
                      <option value="no">Viewed, not identified</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Given name (if now known)</label>
                    <input name="givenName" className={FIELD} defaultValue={open.given_name} />
                  </div>
                  <div>
                    <label className={LABEL}>Family name</label>
                    <input name="familyName" className={FIELD} defaultValue={open.family_name} />
                  </div>
                  <div className="sm:col-span-2 flex items-end gap-2">
                    <div className="flex-1">
                      <label className={LABEL}>Note</label>
                      <input name="note" className={FIELD} placeholder="Not his brother" />
                    </div>
                    <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Record</button>
                  </div>
                </form>
              </Section>

              {open.postmortem_required && !open.postmortem_at ? (
                <Section title="Postmortem" note="It cannot be done after burial, which is why it comes first.">
                  <form action={postmortemAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-4">
                    <input type="hidden" name="bodyId" value={open.id} />
                    <div>
                      <label className={LABEL}>Pathologist</label>
                      <input name="pathologist" required className={FIELD} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={LABEL}>Findings</label>
                      <input name="findings" className={FIELD} />
                    </div>
                    <div>
                      <label className={LABEL}>Cause of death</label>
                      <input name="causeOfDeath" required className={FIELD} />
                    </div>
                    <div className="sm:col-span-4">
                      <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Record postmortem</button>
                    </div>
                  </form>

                  {configuring ? (
                    <form action={waivePostmortemAction} className="mt-3 bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-4 items-end">
                      <input type="hidden" name="bodyId" value={open.id} />
                      <div>
                        <label className={LABEL}>Waived — authorised by</label>
                        <input name="authority" required className={FIELD} placeholder="Dr. Achieng Wanjiru" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={LABEL}>Why it is not needed</label>
                        <input name="reason" required className={FIELD} placeholder="Expected death from a documented illness" />
                      </div>
                      <button className="bg-white border border-line text-sm rounded px-3 py-1.5">Waive</button>
                    </form>
                  ) : null}
                </Section>
              ) : null}

              {!open.notification_ref ? (
                <Section title="Death notification" note="The reference the registrar gives back. The family needs it to bury.">
                  <form action={notificationAction} className="bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
                    <input type="hidden" name="bodyId" value={open.id} />
                    <div className="flex-1 min-w-60">
                      <label className={LABEL}>Reference</label>
                      <input name="reference" required className={FIELD} placeholder="DN/2026/00142" />
                    </div>
                    <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Record</button>
                  </form>
                </Section>
              ) : null}

              <Section title="Release" note="The end of the line. There is no undo for this one.">
                <form action={releaseAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="bodyId" value={open.id} />
                  <div>
                    <label className={LABEL}>Released to</label>
                    <input name="toName" required className={FIELD} placeholder="Mary Mwangi" />
                  </div>
                  <div>
                    <label className={LABEL}>Their ID number</label>
                    <input name="toIdNumber" required className={FIELD} placeholder="12345678" />
                  </div>
                  <div>
                    <label className={LABEL}>Relationship</label>
                    <input name="relationship" required className={FIELD} placeholder="sister" />
                  </div>
                  <div>
                    <label className={LABEL}>Fee</label>
                    <p className="text-sm py-1.5">{formatKes(openFee!.feeCents)}</p>
                  </div>
                  {open.medico_legal ? (
                    <div className="sm:col-span-2">
                      <label className={LABEL}>Police release authority</label>
                      <input name="authority" className={FIELD} placeholder="Release order, Cpl. Wafula, Buruburu" />
                    </div>
                  ) : null}
                  {!open.notification_ref ? (
                    <div className="sm:col-span-2">
                      <label className={LABEL}>Releasing without a notification — why</label>
                      <input name="override" className={FIELD} placeholder="Registrar closed; chief's letter produced" />
                    </div>
                  ) : null}
                  <div>
                    <label className={LABEL}>Waive (KES)</label>
                    <input name="waived" type="number" step="0.01" min="0" className={FIELD} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LABEL}>Waiver reason</label>
                    <input name="waiverReason" className={FIELD} placeholder="Family destitute; approved by the administrator" />
                  </div>
                  <div className="sm:col-span-4">
                    <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Release the body</button>
                  </div>
                </form>
              </Section>
            </>
          ) : null}

          <Section title="The register for this body" note="Append-only. Nobody can edit it, which is the only thing that makes it worth anything.">
            <div className="bg-white border border-line rounded divide-y divide-line">
              {openEvents.map((event) => (
                <div key={event.id} className="px-3 py-2 text-sm">
                  <span className="text-muted">{event.happened_at.slice(0, 16).replace("T", " ")}</span>{" "}
                  <span className="font-medium">{event.kind.replace(/_/g, " ")}</span>
                  {event.detail ? <span> — {event.detail}</span> : null}
                  {event.person_name ? (
                    <span className="text-xs text-muted">
                      {" "}· {event.person_name}
                      {event.person_id ? ` (${event.person_id})` : ""}
                      {event.relationship ? `, ${event.relationship}` : ""}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted"> · recorded by {event.recorder_name}</span>
                </div>
              ))}
            </div>
          </Section>
        </>
      ) : null}

      {/* ================================================= register */}
      {!open && view === "register" ? (
        <>
          <Section title="In store">
            {rows.length === 0 ? (
              <Empty>The mortuary is empty.</Empty>
            ) : (
              <div className="bg-white border border-line rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                    <tr>
                      <th className="px-3 py-2">Tag</th>
                      <th className="px-2 py-2">Who</th>
                      <th className="px-2 py-2">From</th>
                      <th className="px-2 py-2">Bay</th>
                      <th className="px-2 py-2 text-right">Days</th>
                      <th className="px-2 py-2 text-right">Fee</th>
                      <th className="px-2 py-2">Holding it up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.body.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Link href={`/mortuary?b=${row.body.id}`} className="text-brand hover:underline">
                            {row.body.tag_no}
                          </Link>
                        </td>
                        <td className="px-2 py-2">
                          {[row.body.given_name, row.body.family_name].filter(Boolean).join(" ") || (
                            <span className="text-block">unidentified</span>
                          )}
                          {row.body.medico_legal ? (
                            <span className="ml-1 text-xs text-block">police case</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 text-muted">{SOURCE_LABEL[row.body.source]}</td>
                        <td className="px-2 py-2 text-muted">{row.body.unit_code ?? "—"}</td>
                        <td className="px-2 py-2 text-right">{row.days}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">{formatKes(row.feeCents)}</td>
                        <td className="px-2 py-2">
                          {row.check.ok ? (
                            <span className="text-good">releasable</span>
                          ) : row.check.blockers.length > 0 ? (
                            <span className="text-block">{row.check.blockers[0]}</span>
                          ) : (
                            <span className="text-clock">{row.check.overridable[0]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            title="Receive a body"
            note={`The tag is minted here. Storage is free for ${free} days, then ${formatKes(perDay)} a day.`}
          >
            <form action={receiveAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-4">
              <div>
                <label className={LABEL}>Given name</label>
                <input name="givenName" className={FIELD} placeholder="leave blank if unknown" />
              </div>
              <div>
                <label className={LABEL}>Family name</label>
                <input name="familyName" className={FIELD} />
              </div>
              <div>
                <label className={LABEL}>Sex</label>
                <select name="sex" className={FIELD}>
                  <option value="unknown">Unknown</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Age (years)</label>
                <input name="ageYears" type="number" min="0" max="130" className={FIELD} />
              </div>
              <div>
                <label className={LABEL}>From</label>
                <select name="source" className={FIELD}>
                  {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL}>Patient file (if ours)</label>
                <input name="patientMrn" className={FIELD} placeholder="MRN" />
              </div>
              <div>
                <label className={LABEL}>Place of death</label>
                <input name="placeOfDeath" className={FIELD} placeholder="General ward" />
              </div>
              <div>
                <label className={LABEL}>Bay</label>
                <select name="unitCode" className={FIELD}>
                  <option value="">—</option>
                  {units.map((unit) => (
                    <option key={unit.code} value={unit.code} disabled={unit.free <= 0}>
                      {unit.code} · {unit.free} of {unit.bays} free
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL}>Cause of death, if certified</label>
                <input name="causeOfDeath" className={FIELD} />
              </div>
              <div>
                <label className={LABEL}>Certified by</label>
                <input name="certifiedBy" className={FIELD} />
              </div>
              <div>
                <label className={LABEL}>Police OB number</label>
                <input name="policeObNo" className={FIELD} placeholder="OB/14/2026" />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL}>Investigating officer</label>
                <input name="investigatingOfficer" className={FIELD} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="medicoLegal" />
                Police case
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="postmortemRequired" />
                Postmortem required
              </label>
              <div className="sm:col-span-4">
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Receive and tag</button>
              </div>
            </form>
          </Section>
        </>
      ) : null}

      {/* ================================================ unclaimed */}
      {!open && view === "unclaimed" ? (
        <Section
          title={`Nobody has come for these in ${unclaimedAfter} days`}
          note="Longest first. The statutory process for a body nobody claims is a county matter this system does not run."
        >
          {stale.length === 0 ? (
            <Empty>Every body here has a family that has been in touch.</Empty>
          ) : (
            <div className="bg-white border border-line rounded overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                  <tr>
                    <th className="px-3 py-2">Tag</th>
                    <th className="px-2 py-2">Who</th>
                    <th className="px-2 py-2">Received</th>
                    <th className="px-2 py-2 text-right">Days</th>
                    <th className="px-2 py-2 text-right">Accrued</th>
                  </tr>
                </thead>
                <tbody>
                  {stale.map((row) => (
                    <tr key={row.body.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <Link href={`/mortuary?b=${row.body.id}`} className="text-brand hover:underline">
                          {row.body.tag_no}
                        </Link>
                      </td>
                      <td className="px-2 py-2">
                        {[row.body.given_name, row.body.family_name].filter(Boolean).join(" ") || (
                          <span className="text-block">unidentified</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-muted whitespace-nowrap">{row.body.received_at.slice(0, 10)}</td>
                      <td className="px-2 py-2 text-right text-block">{row.days}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">{formatKes(row.feeCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}

      {/* ================================================= released */}
      {!open && view === "released" ? (
        <Section title="Released" note="The tag stays with the body for good. A released tag is never reused.">
          {released.length === 0 ? (
            <Empty>Nothing has been released yet.</Empty>
          ) : (
            <div className="bg-white border border-line rounded overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                  <tr>
                    <th className="px-3 py-2">Tag</th>
                    <th className="px-2 py-2">Who</th>
                    <th className="px-2 py-2">Released to</th>
                    <th className="px-2 py-2">When</th>
                    <th className="px-2 py-2 text-right">Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {released.map((body) => (
                    <tr key={body.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <Link href={`/mortuary?b=${body.id}`} className="text-brand hover:underline">
                          {body.tag_no}
                        </Link>
                      </td>
                      <td className="px-2 py-2">{[body.given_name, body.family_name].filter(Boolean).join(" ")}</td>
                      <td className="px-2 py-2">
                        {body.released_to_name}
                        <span className="text-xs text-muted"> ({body.released_to_relationship})</span>
                        {body.release_override ? (
                          <span className="ml-1 text-xs text-clock">no notification</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-muted whitespace-nowrap">{body.released_at?.slice(0, 10)}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {formatKes(body.paid_cents)}
                        {body.waived_cents > 0 ? (
                          <span className="text-xs text-muted"> · {formatKes(body.waived_cents)} waived</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}

      {/* ==================================================== units */}
      {!open && view === "units" ? (
        <Section title="Cold rooms" note="One body per bay. The fridge itself belongs on the asset register, where its service schedule lives.">
          <div className="bg-white border border-line rounded overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2 text-right">Bays</th>
                  <th className="px-2 py-2 text-right">Occupied</th>
                  <th className="px-2 py-2">Asset</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.code} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{unit.code}</td>
                    <td className="px-2 py-2">{unit.name}</td>
                    <td className="px-2 py-2 text-right">{unit.bays}</td>
                    <td className={`px-2 py-2 text-right ${unit.free === 0 ? "text-block" : ""}`}>{unit.occupied}</td>
                    <td className="px-2 py-2 text-muted">
                      {unit.assetId
                        ? fridges.find((f) => f.id === unit.assetId)?.tag ?? unit.assetId
                        : "not on the asset register"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {configuring ? (
            <form action={unitAction} className="mt-3 bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-4 items-end">
              <div>
                <label className={LABEL}>Code</label>
                <input name="code" required className={FIELD} placeholder="MORT-C" />
              </div>
              <div>
                <label className={LABEL}>Name</label>
                <input name="name" required className={FIELD} placeholder="Cold room C" />
              </div>
              <div>
                <label className={LABEL}>Bays</label>
                <input name="bays" type="number" min="1" defaultValue={1} className={FIELD} />
              </div>
              <div>
                <label className={LABEL}>The fridge, on the asset register</label>
                <select name="assetId" className={FIELD}>
                  <option value="">—</option>
                  {fridges.map((fridge) => (
                    <option key={fridge.id} value={fridge.id}>{fridge.tag} · {fridge.name}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-4">
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Save</button>
              </div>
            </form>
          ) : null}
        </Section>
      ) : null}
    </Shell>
  );
}

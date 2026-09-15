import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  ancRegister, deliveryRegister, childRegister, pncDue, ancDefaulters,
  maternitySummary, ancContactsFor, pncContactsFor, immunisationCard, immunisationSchedule,
  getPregnancy, nextAncContact, expectedDate, gestationWeeks,
  ANC_CONTACT_WEEKS, PNC_SCHEDULE, TERM_WEEKS, LOW_BIRTH_WEIGHT_GRAMS,
} from "@/lib/maternity.ts";
import { searchPatients, resolvePatient } from "@/lib/patients.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import { bookAction, ancAction, deliveryAction, closeAction, pncAction, immuniseAction } from "./actions.ts";

/**
 * Maternity and child health.
 *
 * Four views because the work is four different jobs done by four different
 * people: the antenatal clinic runs a register of due dates, the labour ward
 * records what happened, the postnatal round chases mothers in the days when
 * most maternal deaths occur, and the child health clinic works a card.
 *
 * The register is ordered by expected date, not by booking date. "Who is
 * delivering next" is the only question anybody asks it.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

function bp(systolic: number | null, diastolic: number | null): string {
  if (systolic === null && diastolic === null) return "—";
  return `${systolic ?? "–"}/${diastolic ?? "–"}`;
}

export default async function MaternityPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; p?: string; d?: string; child?: string; q?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "patient.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "antenatal";
  const conduct = can(user.userId, "encounter.conduct");

  const register = ancRegister();
  const overdue = ancDefaulters();
  const deliveries = deliveryRegister();
  const postnatal = pncDue();
  const children = childRegister();
  const summary = maternitySummary();

  const candidates = params.q?.trim()
    ? searchPatients({ facilityId: user.facilityId, query: params.q, limit: 6 }).filter((p) => p.sex === "female")
    : [];

  const open = params.p ? getPregnancy(params.p) : undefined;
  const openRow = open ? register.find((r) => r.pregnancy.id === open.id) : undefined;
  const openContacts = open ? ancContactsFor(open.id) : [];
  const openNext = open ? nextAncContact(open.id) : null;
  const openMother = open ? resolvePatient(open.patient_mrn) : undefined;

  const openDelivery = params.d ? deliveries.find((d) => d.delivery.id === params.d) : undefined;
  const openPnc = openDelivery ? pncContactsFor(openDelivery.delivery.id) : [];

  const child = params.child ? resolvePatient(params.child) : undefined;
  const card = child ? immunisationCard(child.mrn) : [];

  const href = (v: string) => (v === "antenatal" ? "/maternity" : `/maternity?view=${v}`);

  return (
    <Shell
      user={user}
      current={href(view)}
      error={params.error}
      title={
        view === "births" ? "Deliveries & births"
        : view === "postnatal" ? "Postnatal follow-up"
        : view === "immunisation" ? "Child health & immunisation"
        : "Antenatal clinic"
      }
      subtitle={
        view === "antenatal"
          ? "Open pregnancies, soonest expected first. Maternity is covered inside the SHA package and claimed against the mother's SHA number — there is no separate scheme number to capture."
          : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "antenatal", label: "Antenatal", href: "/maternity" },
          { key: "births", label: "Deliveries", href: "/maternity?view=births" },
          { key: "postnatal", label: "Postnatal", href: "/maternity?view=postnatal" },
          { key: "immunisation", label: "Child health", href: "/maternity?view=immunisation" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Open pregnancies" value={summary.activePregnancies} note={`${summary.booked} booked ever`} />
        <Stat
          label="Contact overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? "clock" : "good"}
          note="missed an antenatal appointment"
        />
        <Stat
          label="Caesarean rate"
          value={summary.caesareanRatePercent === null ? "—" : `${summary.caesareanRatePercent}%`}
          tone={summary.caesareanRatePercent === null ? "muted" : summary.caesareanRatePercent > 30 ? "clock" : "good"}
          note={`${summary.caesareans} of ${summary.deliveries} deliveries`}
        />
        <Stat
          label="Live births"
          value={summary.liveBirths}
          tone={summary.stillbirths > 0 ? "clock" : "good"}
          note={
            summary.stillbirthRatePer1000 === null
              ? "no births recorded yet"
              : `${summary.stillbirths} stillbirths · ${summary.stillbirthRatePer1000} per 1000`
          }
        />
      </div>

      {/* ================================================== antenatal register */}
      {view === "antenatal" ? (
        <>
          {overdue.length > 0 ? (
            <Section
              title="Not come back"
              note="A missed antenatal contact is measured in mothers. Longest overdue first."
            >
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Mother</th>
                    <th className="px-3 py-2 font-medium">Last seen</th>
                    <th className="px-3 py-2 font-medium">Was due</th>
                    <th className="px-3 py-2 font-medium text-right">Contact</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.map((d) => (
                    <tr key={d.pregnancy_id} className="border-t border-line bg-clock-soft">
                      <td className="px-3 py-2">
                        <Link href={`/patients/${encodeURIComponent(d.patient_mrn)}`} className="underline underline-offset-2">
                          {d.patient_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 tnum text-muted">{d.last_seen}</td>
                      <td className="px-3 py-2 tnum text-clock font-semibold">{d.next_due}</td>
                      <td className="px-3 py-2 text-right tnum">#{d.contact_number}</td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/maternity?p=${d.pregnancy_id}`} className="text-brand underline underline-offset-2 text-xs">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ) : null}

          <Section
            title="Antenatal register"
            note={`WHO's schedule is ${ANC_CONTACT_WEEKS.length} contacts, at ${ANC_CONTACT_WEEKS.join(", ")} weeks. Awaiting clinical sign-off — see the clinical review register.`}
          >
            {register.length === 0 ? (
              <Empty>No pregnancy is booked.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Mother</th>
                      <th className="px-3 py-2 font-medium text-right">Gestation</th>
                      <th className="px-3 py-2 font-medium">Expected</th>
                      <th className="px-3 py-2 font-medium text-right">Contacts</th>
                      <th className="px-3 py-2 font-medium">Next due</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {register.map((r) => (
                      <tr
                        key={r.pregnancy.id}
                        className={`border-t border-line ${r.pregnancy.id === open?.id ? "bg-brand-soft" : r.overdue ? "bg-clock-soft" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <Link href={`/patients/${encodeURIComponent(r.pregnancy.patient_mrn)}`} className="underline underline-offset-2">
                            {r.patientName}
                          </Link>
                          {r.pregnancy.gravida ? (
                            <span className="text-xs text-muted ml-2 tnum">
                              G{r.pregnancy.gravida}P{r.pregnancy.para ?? 0}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right tnum font-semibold">
                          {r.gestationWeeks === null ? "—" : `${r.gestationWeeks} wk`}
                        </td>
                        <td className="px-3 py-2 tnum">
                          {r.edd ?? "—"}
                          <span className="text-[10px] text-muted ml-1 uppercase tracking-wide">
                            {r.eddSource === "scan" ? "by scan" : r.eddSource === "lmp" ? "by dates" : ""}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tnum">{r.contacts}</td>
                        <td className={`px-3 py-2 tnum ${r.nextDue && r.nextDue < today() ? "text-clock font-semibold" : "text-muted"}`}>
                          {r.nextDue ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link href={`/maternity?p=${r.pregnancy.id}`} className="text-brand underline underline-offset-2 text-xs">
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ------------------------------------------- one pregnancy in detail */}
          {open && openMother ? (
            <Section
              title={`${openMother.given_name} ${openMother.family_name} — booked ${open.booked_on}`}
              note={
                openRow
                  ? `${openRow.gestationWeeks ?? "?"} weeks · expected ${openRow.edd ?? "unknown"} ${openRow.eddSource === "scan" ? "by scan" : "by dates"}${open.cover_ref ? ` · cover ${open.cover_ref}` : ""}`
                  : undefined
              }
            >
              {openContacts.length > 0 ? (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm bg-white border border-line rounded">
                    <thead>
                      <tr className="text-xs text-muted text-left">
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium text-right">Weeks</th>
                        <th className="px-3 py-2 font-medium">BP</th>
                        <th className="px-3 py-2 font-medium text-right">Hb</th>
                        <th className="px-3 py-2 font-medium">Given</th>
                        <th className="px-3 py-2 font-medium">Danger signs</th>
                        <th className="px-3 py-2 font-medium">Next due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openContacts.map((c) => {
                        const high = (c.systolic_mmhg ?? 0) >= 140 || (c.diastolic_mmhg ?? 0) >= 90;
                        const anaemic = c.haemoglobin_milli !== null && c.haemoglobin_milli < 7000;
                        return (
                          <tr key={c.id} className={`border-t border-line ${high || anaemic || c.danger_signs ? "bg-block-soft" : ""}`}>
                            <td className="px-3 py-2 tnum">{c.contact_number}</td>
                            <td className="px-3 py-2 tnum">{c.contact_date}</td>
                            <td className="px-3 py-2 text-right tnum">{c.gestation_weeks ?? "—"}</td>
                            <td className={`px-3 py-2 tnum ${high ? "text-block font-bold" : ""}`}>
                              {bp(c.systolic_mmhg, c.diastolic_mmhg)}
                            </td>
                            <td className={`px-3 py-2 text-right tnum ${anaemic ? "text-block font-bold" : ""}`}>
                              {c.haemoglobin_milli === null ? "—" : (c.haemoglobin_milli / 1000).toFixed(1)}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted">
                              {[c.tt_given && "TT", c.iptp_given && "IPTp", c.iron_given && "Iron", c.llin_given && "Net", c.hiv_tested && "HIV"]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </td>
                            <td className="px-3 py-2 text-xs text-block font-semibold">{c.danger_signs || ""}</td>
                            <td className="px-3 py-2 tnum text-muted">{c.next_due ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted mb-4">No antenatal contact recorded yet.</p>
              )}

              {conduct ? (
                <>
                  <form action={ancAction} className="bg-white border border-line rounded p-3">
                    <input type="hidden" name="pregnancyId" value={open.id} />
                    <p className="text-xs text-muted mb-3">
                      Contact {openNext ? `${openNext.number}, expected at ${openNext.atWeeks} weeks` : "— schedule complete"}.
                      A systolic of 140 or a diastolic of 90 raises a critical alert; so does a haemoglobin under 7.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <label><span className={LABEL}>Date</span><input type="date" name="contactDate" defaultValue={today()} className={FIELD} /></label>
                      <label><span className={LABEL}>Weight (kg)</span><input name="weightKg" inputMode="decimal" className={FIELD} /></label>
                      <label><span className={LABEL}>Systolic</span><input name="systolic" inputMode="numeric" className={FIELD} /></label>
                      <label><span className={LABEL}>Diastolic</span><input name="diastolic" inputMode="numeric" className={FIELD} /></label>
                      <label><span className={LABEL}>Fundal height (cm)</span><input name="fundalHeightCm" inputMode="numeric" className={FIELD} /></label>
                      <label><span className={LABEL}>Haemoglobin (g/dL)</span><input name="haemoglobin" inputMode="decimal" className={FIELD} /></label>
                      <label><span className={LABEL}>Next due</span><input type="date" name="nextDue" className={FIELD} /></label>
                      <label><span className={LABEL}>Danger signs</span><input name="dangerSigns" placeholder="bleeding, headache, fits…" className={FIELD} /></label>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-3 text-sm">
                      {[["ttGiven", "Tetanus"], ["iptpGiven", "IPTp"], ["ironGiven", "Iron & folate"], ["llinGiven", "Net"], ["hivTested", "HIV tested"]].map(([name, label]) => (
                        <label key={name} className="flex items-center gap-1.5">
                          <input type="checkbox" name={name} /> <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <label className="block mt-3"><span className={LABEL}>Note</span><input name="note" className={FIELD} /></label>
                    <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                      Record contact
                    </button>
                  </form>

                  <div className="grid gap-4 sm:grid-cols-2 mt-4">
                    <form action={deliveryAction} className="bg-white border border-line rounded p-3">
                      <input type="hidden" name="pregnancyId" value={open.id} />
                      <p className="text-sm font-semibold mb-1">Record the delivery</p>
                      <p className="text-xs text-muted mb-3">
                        Every live baby is registered as a patient of their own — without a file number a newborn
                        cannot be immunised or weighed. Twins are two records.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label><span className={LABEL}>Mode</span>
                          <select name="mode" className={FIELD}>
                            <option value="spontaneous_vertex">Spontaneous vertex</option>
                            <option value="assisted">Assisted</option>
                            <option value="caesarean">Caesarean</option>
                            <option value="breech">Breech</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        <label><span className={LABEL}>Place</span>
                          <select name="place" className={FIELD}>
                            <option value="facility">This facility</option>
                            <option value="home">Home</option>
                            <option value="in_transit">In transit</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        <label><span className={LABEL}>Blood loss (ml)</span><input name="bloodLossMl" inputMode="numeric" className={FIELD} /></label>
                        <label><span className={LABEL}>Mother</span>
                          <select name="motherOutcome" className={FIELD}>
                            <option value="alive">Alive</option>
                            <option value="died">Died</option>
                          </select>
                        </label>
                      </div>
                      <label className="block mt-3"><span className={LABEL}>Complications</span><input name="complications" className={FIELD} /></label>

                      {[1, 2, 3].map((n) => (
                        <div key={n} className="mt-3 pt-3 border-t border-line">
                          <p className="text-xs font-semibold text-muted mb-2">
                            Baby {n}{n > 1 ? " (leave the outcome blank if there is no baby " + n + ")" : ""}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-4">
                            <label><span className={LABEL}>Outcome</span>
                              <select name={`outcome${n}`} className={FIELD} defaultValue={n === 1 ? "live" : ""}>
                                <option value=""></option>
                                <option value="live">Live birth</option>
                                <option value="stillbirth_fresh">Stillbirth, fresh</option>
                                <option value="stillbirth_macerated">Stillbirth, macerated</option>
                                <option value="died">Died after birth</option>
                              </select>
                            </label>
                            <label><span className={LABEL}>Sex</span>
                              <select name={`sex${n}`} className={FIELD}>
                                <option value="female">Female</option>
                                <option value="male">Male</option>
                                <option value="unknown">Unknown</option>
                              </select>
                            </label>
                            <label><span className={LABEL}>Weight (g)</span><input name={`weight${n}`} inputMode="numeric" className={FIELD} /></label>
                            <label><span className={LABEL}>Apgar 1 / 5</span>
                              <div className="flex gap-1">
                                <input name={`apgar1_${n}`} inputMode="numeric" className={FIELD} />
                                <input name={`apgar5_${n}`} inputMode="numeric" className={FIELD} />
                              </div>
                            </label>
                          </div>
                        </div>
                      ))}

                      <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                        Record delivery
                      </button>
                    </form>

                    <form action={closeAction} className="bg-white border border-line rounded p-3 self-start">
                      <input type="hidden" name="pregnancyId" value={open.id} />
                      <p className="text-sm font-semibold mb-1">Close without a delivery</p>
                      <p className="text-xs text-muted mb-3">
                        A pregnancy left open keeps generating an antenatal schedule for a woman who is no longer
                        pregnant. Closing it must record why.
                      </p>
                      <label className="block"><span className={LABEL}>Outcome</span>
                        <select name="status" className={FIELD}>
                          <option value="miscarried">Miscarried</option>
                          <option value="terminated">Terminated</option>
                          <option value="transferred">Transferred out</option>
                          <option value="lost">Lost to follow-up</option>
                        </select>
                      </label>
                      <label className="block mt-3"><span className={LABEL}>Why</span><input name="note" className={FIELD} /></label>
                      <button type="submit" className="mt-3 border border-line font-semibold rounded px-4 py-2 text-sm">
                        Close pregnancy
                      </button>
                    </form>
                  </div>
                </>
              ) : null}
            </Section>
          ) : null}

          {/* ------------------------------------------------- book a pregnancy */}
          {conduct ? (
            <Section
              title="Book a pregnancy"
              note="A pregnancy needs a last menstrual period or a scan date. An undated pregnancy cannot be scheduled, cannot be assessed for prematurity, and cannot be claimed — so it is refused here rather than at the delivery."
            >
              <form method="get" className="mb-3 flex gap-2">
                <input
                  name="q"
                  defaultValue={params.q ?? ""}
                  placeholder="Find her by name, file number or SHA number"
                  className={`${FIELD} max-w-md`}
                />
                <button type="submit" className="border border-line font-semibold rounded px-4 py-2 text-sm">Search</button>
              </form>

              {candidates.length > 0 ? (
                <div className="space-y-2">
                  {candidates.map((c) => (
                    <form action={bookAction} key={c.mrn} className="bg-white border border-line rounded p-3">
                      <input type="hidden" name="mrn" value={c.mrn} />
                      <p className="text-sm font-semibold mb-2">
                        {c.given_name} {c.family_name} <span className="font-mono text-xs text-muted ml-2">{c.mrn}</span>
                      </p>
                      <div className="grid gap-3 sm:grid-cols-5">
                        <label><span className={LABEL}>Last period</span><input type="date" name="lmp" className={FIELD} /></label>
                        <label><span className={LABEL}>Or expected date, by scan</span><input type="date" name="eddOverride" className={FIELD} /></label>
                        <label><span className={LABEL}>Gravida</span><input name="gravida" inputMode="numeric" className={FIELD} /></label>
                        <label><span className={LABEL}>Para</span><input name="para" inputMode="numeric" className={FIELD} /></label>
                        <label><span className={LABEL}>Payer reference</span><input name="coverRef" placeholder="optional" className={FIELD} /></label>
                      </div>
                      <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">Book</button>
                    </form>
                  ))}
                </div>
              ) : params.q ? (
                <Empty>No patient recorded as female matches that.</Empty>
              ) : null}
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ====================================================== deliveries */}
      {view === "births" ? (
        <Section
          title="Deliveries"
          note={`Under ${TERM_WEEKS} weeks is preterm; under ${LOW_BIRTH_WEIGHT_GRAMS} g is low birth weight and is reported. Both raise an alert at the time.`}
        >
          {deliveries.length === 0 ? (
            <Empty>No delivery has been recorded.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Delivered</th>
                    <th className="px-3 py-2 font-medium">Mother</th>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium text-right">Weeks</th>
                    <th className="px-3 py-2 font-medium">Babies</th>
                    <th className="px-3 py-2 font-medium text-right">Blood loss</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.delivery.id} className={`border-t border-line ${d.delivery.mother_outcome === "died" ? "bg-block-soft" : ""}`}>
                      <td className="px-3 py-2 tnum">{d.delivery.delivered_at.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-3 py-2">
                        <Link href={`/patients/${encodeURIComponent(d.patientMrn)}`} className="underline underline-offset-2">
                          {d.patientName}
                        </Link>
                        {d.delivery.mother_outcome === "died" ? (
                          <span className="text-xs text-block font-bold ml-2">MATERNAL DEATH</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 capitalize">{d.delivery.mode.replace(/_/g, " ")}</td>
                      <td className={`px-3 py-2 text-right tnum ${d.preterm ? "text-clock font-bold" : ""}`}>
                        {d.delivery.gestation_weeks ?? "—"}
                        {d.preterm ? <span className="text-[10px] ml-1">preterm</span> : null}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {d.babies.map((b) => (
                          <div key={b.id}>
                            {b.patient_mrn ? (
                              <Link href={`/patients/${encodeURIComponent(b.patient_mrn)}`} className="underline underline-offset-2">
                                {b.sex}, {b.birth_weight_grams ?? "?"} g
                              </Link>
                            ) : (
                              <span className="text-muted">{b.sex}, {b.birth_weight_grams ?? "?"} g</span>
                            )}
                            {b.outcome !== "live" ? (
                              <span className="text-block font-semibold ml-1">{b.outcome.replace(/_/g, " ")}</span>
                            ) : b.birth_weight_grams !== null && b.birth_weight_grams < LOW_BIRTH_WEIGHT_GRAMS ? (
                              <span className="text-clock font-semibold ml-1">low birth weight</span>
                            ) : null}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right tnum text-muted">
                        {d.delivery.blood_loss_ml === null ? "—" : `${d.delivery.blood_loss_ml} ml`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}

      {/* ====================================================== postnatal */}
      {view === "postnatal" ? (
        <>
          <Section
            title="Postnatal follow-up"
            note={`${PNC_SCHEDULE.map((s) => s.label).join(" · ")}. Most maternal deaths happen in these days, which is why the schedule is short and front-loaded.`}
          >
            {postnatal.length === 0 ? (
              <Empty>No mother is due a postnatal contact.</Empty>
            ) : (
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Mother</th>
                    <th className="px-3 py-2 font-medium">Delivered</th>
                    <th className="px-3 py-2 font-medium text-right">Contacts</th>
                    <th className="px-3 py-2 font-medium">Next on the schedule</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {postnatal.map((d) => (
                    <tr key={d.deliveryId} className={`border-t border-line ${d.behind ? "bg-clock-soft" : ""}`}>
                      <td className="px-3 py-2">
                        <Link href={`/patients/${encodeURIComponent(d.patientMrn)}`} className="underline underline-offset-2">
                          {d.patientName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 tnum">{d.deliveredAt.slice(0, 10)}</td>
                      <td className="px-3 py-2 text-right tnum">{d.done} of {d.expected} due</td>
                      <td className={`px-3 py-2 ${d.behind ? "text-clock font-semibold" : "text-muted"}`}>{d.next?.label}</td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/maternity?view=postnatal&d=${d.deliveryId}`} className="text-brand underline underline-offset-2 text-xs">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {openDelivery ? (
            <Section
              title={`${openDelivery.patientName} — delivered ${openDelivery.delivery.delivered_at.slice(0, 10)}`}
              note={`${openDelivery.delivery.mode.replace(/_/g, " ")} · ${openDelivery.babies.length} baby/babies`}
            >
              {openPnc.length > 0 ? (
                <table className="w-full text-sm bg-white border border-line rounded mb-4">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Seen</th>
                      <th className="px-3 py-2 font-medium">On the schedule</th>
                      <th className="px-3 py-2 font-medium">Mother</th>
                      <th className="px-3 py-2 font-medium">Baby</th>
                      <th className="px-3 py-2 font-medium">Danger signs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPnc.map((c) => (
                      <tr key={c.id} className={`border-t border-line ${c.danger_signs ? "bg-block-soft" : ""}`}>
                        <td className="px-3 py-2 tnum">{c.contact_date}</td>
                        <td className="px-3 py-2 text-muted">{c.scheduled_at}</td>
                        <td className="px-3 py-2 text-xs">{c.mother_findings || "—"}</td>
                        <td className="px-3 py-2 text-xs">{c.baby_findings || "—"}</td>
                        <td className="px-3 py-2 text-xs text-block font-semibold">{c.danger_signs || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {conduct ? (
                <form action={pncAction} className="bg-white border border-line rounded p-3">
                  <input type="hidden" name="deliveryId" value={openDelivery.delivery.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label><span className={LABEL}>On the schedule</span>
                      <select name="scheduledAt" className={FIELD} defaultValue={PNC_SCHEDULE[openPnc.length]?.label ?? PNC_SCHEDULE[0].label}>
                        {PNC_SCHEDULE.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
                      </select>
                    </label>
                    <label><span className={LABEL}>Date</span><input type="date" name="contactDate" defaultValue={today()} className={FIELD} /></label>
                    <label><span className={LABEL}>Next due</span><input type="date" name="nextDue" className={FIELD} /></label>
                    <label><span className={LABEL}>Mother</span><input name="motherFindings" className={FIELD} /></label>
                    <label><span className={LABEL}>Baby</span><input name="babyFindings" className={FIELD} /></label>
                    <label><span className={LABEL}>Danger signs</span><input name="dangerSigns" placeholder="raises a critical alert" className={FIELD} /></label>
                  </div>
                  <button type="submit" className="mt-3 bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
                    Record postnatal contact
                  </button>
                </form>
              ) : null}
            </Section>
          ) : null}
        </>
      ) : null}

      {/* =================================================== child health */}
      {view === "immunisation" ? (
        <>
          <Section
            title="Children born here"
            note="Due dates come from each child's own date of birth, which is why a live baby is registered as a patient at delivery. A child attached only to the mother's record has no card."
          >
            {children.length === 0 ? (
              <Empty>No live birth has been recorded.</Empty>
            ) : (
              <table className="w-full text-sm bg-white border border-line rounded">
                <thead>
                  <tr className="text-xs text-muted text-left">
                    <th className="px-3 py-2 font-medium">Child</th>
                    <th className="px-3 py-2 font-medium">Born</th>
                    <th className="px-3 py-2 font-medium text-right">Age</th>
                    <th className="px-3 py-2 font-medium text-right">Given</th>
                    <th className="px-3 py-2 font-medium text-right">Overdue</th>
                    <th className="px-3 py-2 font-medium">Next</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {children.map((c) => (
                    <tr key={c.mrn} className={`border-t border-line ${c.mrn === child?.mrn ? "bg-brand-soft" : c.overdue > 0 ? "bg-clock-soft" : ""}`}>
                      <td className="px-3 py-2">{c.name}</td>
                      <td className="px-3 py-2 tnum">{c.dateOfBirth ?? "—"}</td>
                      <td className="px-3 py-2 text-right tnum">{c.ageWeeks === null ? "—" : `${c.ageWeeks} wk`}</td>
                      <td className="px-3 py-2 text-right tnum text-good">{c.given}</td>
                      <td className={`px-3 py-2 text-right tnum ${c.overdue > 0 ? "text-clock font-bold" : "text-muted"}`}>
                        {c.overdue || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{c.nextDue ? `${c.nextDue.name} (${c.nextDue.dueOn ?? "?"})` : "schedule complete"}</td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/maternity?view=immunisation&child=${encodeURIComponent(c.mrn)}`} className="text-brand underline underline-offset-2 text-xs">
                          Card
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {child ? (
            <Section
              title={`${child.given_name} ${child.family_name} — immunisation card`}
              note={`Born ${child.date_of_birth ?? "unknown"}. Giving a vaccine twice is refused: a repeat dose is a reportable event, not a second row.`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm bg-white border border-line rounded">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="px-3 py-2 font-medium">Vaccine</th>
                      <th className="px-3 py-2 font-medium text-right">Due at</th>
                      <th className="px-3 py-2 font-medium">Due on</th>
                      <th className="px-3 py-2 font-medium">Given</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.map((v) => (
                      <tr key={v.code} className={`border-t border-line ${v.overdue ? "bg-clock-soft" : ""}`}>
                        <td className="px-3 py-2">{v.name} <span className="font-mono text-xs text-muted ml-1">{v.code}</span></td>
                        <td className="px-3 py-2 text-right tnum text-muted">{v.dueWeeks === 0 ? "birth" : `${v.dueWeeks} wk`}</td>
                        <td className="px-3 py-2 tnum text-muted">{v.dueOn ?? "—"}</td>
                        <td className={`px-3 py-2 tnum ${v.givenOn ? "text-good font-semibold" : v.overdue ? "text-clock font-semibold" : "text-muted"}`}>
                          {v.givenOn ?? (v.overdue ? "overdue" : "—")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {conduct && !v.givenOn ? (
                            <form action={immuniseAction} className="flex gap-1 justify-end">
                              <input type="hidden" name="mrn" value={child.mrn} />
                              <input type="hidden" name="vaccineCode" value={v.code} />
                              <input name="batchNumber" placeholder="batch" className="border border-line rounded px-2 py-1 text-xs w-24" />
                              <button type="submit" className="border border-brand text-brand font-semibold rounded px-2 py-1 text-xs">
                                Give
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted mt-3 leading-relaxed">
                {immunisationSchedule()[0]?.source}
              </p>
            </Section>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}

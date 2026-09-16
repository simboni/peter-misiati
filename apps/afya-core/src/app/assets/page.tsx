import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  assetSummary, maintenanceDue, openFaults, coldChainBoard, listAssets,
  getAsset, schedulesFor, maintenanceFor, workOrdersFor, temperatureLog,
  usable, bookValue, COLD_CHAIN_RANGE, DUE_HORIZON_DAYS,
} from "@/lib/assets.ts";
import { listStores } from "@/lib/inventory.ts";
import { formatKes } from "@/lib/billing.ts";
import { today } from "@/lib/db.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import {
  addAssetAction, statusAction, scheduleAction, maintenanceAction,
  faultAction, closeFaultAction, temperatureAction, depreciationAction,
} from "./actions.ts";

/**
 * Assets and maintenance.
 *
 * The due board leads rather than the register, because the register is a list
 * of things a facility owns and the board is a list of things somebody has to
 * do before a theatre opens. An asset register that opens on the inventory is
 * an asset register nobody reads.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

const CATEGORY_LABEL: Record<string, string> = {
  equipment: "Equipment",
  vehicle: "Vehicle",
  furniture: "Furniture",
  building: "Building",
  it: "IT",
  cold_chain: "Cold chain",
};

const STATUS_LABEL: Record<string, string> = {
  in_service: "In service",
  out_of_service: "Out of service",
  under_repair: "Under repair",
  disposed: "Disposed",
};

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; a?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "report.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "due";
  const configuring = can(user.userId, "facility.configure");

  const summary = assetSummary(user.facilityId);
  const due = maintenanceDue(user.facilityId);
  const faults = openFaults(user.facilityId);
  const cold = coldChainBoard(user.facilityId);
  const assets = listAssets(user.facilityId);
  const stores = listStores(user.facilityId);

  const open = params.a ? getAsset(params.a) : undefined;
  const openSchedules = open ? schedulesFor(open.id) : [];
  const openHistory = open ? maintenanceFor(open.id) : [];
  const openOrders = open ? workOrdersFor(open.id) : [];
  const openReadings = open && open.category === "cold_chain" ? temperatureLog(open.id, 20) : [];
  const openUsable = open ? usable(open.id) : undefined;

  const period = today().slice(0, 7);

  return (
    <Shell
      user={user}
      current="/assets"
      error={params.error}
      title={
        view === "cold" ? "Cold chain"
        : view === "register" ? "Asset register"
        : view === "faults" ? "Faults and repairs"
        : view === "value" ? "Value and depreciation"
        : "Maintenance due"
      }
      subtitle={
        view === "due"
          ? "Blocking checks first. An overdue blocking check is not a backlog item — the equipment is already refused."
          : view === "cold"
            ? `Range is ${COLD_CHAIN_RANGE.minTenths / 10} to ${COLD_CHAIN_RANGE.maxTenths / 10} °C. A reading outside it quarantines everything in that fridge's store, now, without waiting for anybody to join the two facts up.`
            : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "due", label: "Due", href: "/assets" },
          { key: "faults", label: "Faults", href: "/assets?view=faults" },
          { key: "cold", label: "Cold chain", href: "/assets?view=cold" },
          { key: "register", label: "Register", href: "/assets?view=register" },
          { key: "value", label: "Value", href: "/assets?view=value" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Blocked by an overdue check"
          value={summary.blockingOverdue}
          tone={summary.blockingOverdue > 0 ? "block" : "good"}
          note={`${summary.dueSoon} more due within ${DUE_HORIZON_DAYS} days`}
        />
        <Stat
          label="Critical equipment down"
          value={summary.criticalDown}
          tone={summary.criticalDown > 0 ? "block" : "good"}
          note={`${summary.openFaults} open fault${summary.openFaults === 1 ? "" : "s"}`}
        />
        <Stat
          label="Fridges out of range"
          value={summary.coldChainOutOfRange}
          tone={summary.coldChainOutOfRange > 0 ? "block" : summary.coldChainUnread > 0 ? "clock" : "good"}
          note={
            summary.quarantinedBatches > 0
              ? `${summary.quarantinedBatches} batch${summary.quarantinedBatches === 1 ? "" : "es"} quarantined`
              : `${summary.coldChainUnread} unread since yesterday`
          }
        />
        <Stat
          label="Book value"
          value={formatKes(summary.bookValueCents)}
          note={`${summary.assets} assets · ${formatKes(summary.costCents)} at cost`}
        />
      </div>

      {summary.paidUnderWarranty > 0 ? (
        <p className="mt-4 text-xs bg-white border border-line rounded px-3 py-2 text-muted">
          {summary.paidUnderWarranty} repair{summary.paidUnderWarranty === 1 ? " was" : "s were"} paid for on
          equipment that was still under warranty. That is money the facility was owed and did not claim.
        </p>
      ) : null}

      {/* ========================================================== due */}
      {view === "due" ? (
        <Section title="Maintenance due" note="Overdue blocking checks first, then by date.">
          {due.length === 0 ? (
            <Empty>Nothing is due in the next {DUE_HORIZON_DAYS} days.</Empty>
          ) : (
            <div className="bg-white border border-line rounded overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                  <tr>
                    <th className="px-3 py-2">Asset</th>
                    <th className="px-2 py-2">Check</th>
                    <th className="px-2 py-2">Regulator</th>
                    <th className="px-2 py-2">Due</th>
                    <th className="px-2 py-2">Standing</th>
                  </tr>
                </thead>
                <tbody>
                  {due.map((row) => (
                    <tr key={row.scheduleId} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <Link href={`/assets?view=register&a=${row.assetId}`} className="text-brand hover:underline">
                          {row.tag}
                        </Link>
                        <span className="text-muted"> · {row.name}</span>
                        {row.critical ? <span className="ml-1 text-xs text-block">critical</span> : null}
                      </td>
                      <td className="px-2 py-2">{row.scheduleName}</td>
                      <td className="px-2 py-2 text-muted">{row.regulator || "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{row.nextDueOn}</td>
                      <td className="px-2 py-2">
                        {row.overdue && row.blocksUse ? (
                          <span className="text-block font-medium">
                            overdue {-row.daysLeft}d — equipment refused
                          </span>
                        ) : row.overdue ? (
                          <span className="text-clock">overdue {-row.daysLeft}d</span>
                        ) : (
                          <span className="text-muted">in {row.daysLeft}d</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}

      {/* ======================================================= faults */}
      {view === "faults" ? (
        <Section title="Open faults" note="Critical equipment first, then longest down. Downtime runs from when it was reported.">
          {faults.length === 0 ? (
            <Empty>Nothing is reported broken.</Empty>
          ) : (
            <div className="space-y-3">
              {faults.map((fault) => (
                <div key={fault.workOrderId} className="bg-white border border-line rounded p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link href={`/assets?view=register&a=${fault.assetId}`} className="font-medium text-brand hover:underline">
                      {fault.tag}
                    </Link>
                    <span className="text-sm">{fault.name}</span>
                    <span className="text-xs text-muted">{fault.location || "no location recorded"}</span>
                    {fault.critical ? <span className="text-xs text-block">critical</span> : null}
                    {fault.underWarranty ? (
                      <span className="text-xs text-good">under warranty — do not pay for this</span>
                    ) : null}
                  </div>
                  <p className="text-sm mt-1">{fault.fault}</p>
                  <p className="text-xs text-muted mt-1">
                    {fault.outOfService ? "Out of service" : "Still usable"} · down {fault.downHours}h ·
                    reported by {fault.reporterName}
                  </p>

                  <form action={closeFaultAction} className="mt-3 grid gap-2 sm:grid-cols-5 items-end">
                    <input type="hidden" name="workOrderId" value={fault.workOrderId} />
                    <div className="sm:col-span-2">
                      <label className={LABEL}>What was done</label>
                      <input name="resolution" required className={FIELD} placeholder="New starter motor fitted" />
                    </div>
                    <div>
                      <label className={LABEL}>Outcome</label>
                      <select name="status" className={FIELD}>
                        <option value="fixed">Fixed</option>
                        <option value="beyond_repair">Beyond repair</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                    <div>
                      <label className={LABEL}>Cost (KES)</label>
                      <input name="cost" type="number" step="0.01" min="0" className={FIELD} />
                    </div>
                    <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Close</button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {/* =================================================== cold chain */}
      {view === "cold" ? (
        <Section title="Cold chain" note="Twice a day, morning and evening, is the usual practice.">
          {cold.length === 0 ? (
            <Empty>No cold chain assets are on the register.</Empty>
          ) : (
            <div className="space-y-3">
              {cold.map((row) => (
                <div key={row.asset.id} className="bg-white border border-line rounded p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link href={`/assets?view=register&a=${row.asset.id}`} className="font-medium text-brand hover:underline">
                      {row.asset.tag}
                    </Link>
                    <span className="text-sm">{row.asset.name}</span>
                    <span className="text-xs text-muted">holds {row.asset.store_code}</span>
                  </div>
                  <p className="text-sm mt-1">
                    {row.lastReadingTenths === null ? (
                      <span className="text-block">never read</span>
                    ) : (
                      <>
                        <span className={row.inRange ? "text-good font-medium" : "text-block font-medium"}>
                          {(row.lastReadingTenths / 10).toFixed(1)} °C
                        </span>
                        <span className="text-muted">
                          {" "}
                          at {row.lastTakenAt?.slice(0, 16).replace("T", " ")} ({row.hoursSinceReading}h ago)
                        </span>
                      </>
                    )}
                    {row.overdueReading ? <span className="text-clock"> · nobody is watching this fridge</span> : null}
                  </p>
                  <p className="text-xs text-muted mt-1">
                    {row.batches} batch{row.batches === 1 ? "" : "es"} inside
                    {row.quarantinedBatches > 0 ? (
                      <span className="text-block"> · {row.quarantinedBatches} quarantined</span>
                    ) : null}
                  </p>

                  <form action={temperatureAction} className="mt-3 flex flex-wrap gap-2 items-end">
                    <input type="hidden" name="assetId" value={row.asset.id} />
                    <div>
                      <label className={LABEL}>Reading (°C)</label>
                      <input name="degrees" type="number" step="0.1" min="-40" max="60" required className={`${FIELD} w-32`} />
                    </div>
                    <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Record</button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {/* ===================================================== register */}
      {view === "register" && !open ? (
        <>
          <Section title="Register">
            {assets.length === 0 ? (
              <Empty>Nothing is on the register yet.</Empty>
            ) : (
              <div className="bg-white border border-line rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                    <tr>
                      <th className="px-3 py-2">Tag</th>
                      <th className="px-2 py-2">Asset</th>
                      <th className="px-2 py-2">Where</th>
                      <th className="px-2 py-2">Kind</th>
                      <th className="px-2 py-2">Standing</th>
                      <th className="px-2 py-2 text-right">Book value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => {
                      const state = usable(asset.id);
                      return (
                        <tr key={asset.id} className="border-b border-line last:border-0">
                          <td className="px-3 py-2">
                            <Link href={`/assets?view=register&a=${asset.id}`} className="text-brand hover:underline">
                              {asset.tag}
                            </Link>
                          </td>
                          <td className="px-2 py-2">
                            {asset.name}
                            {asset.critical ? <span className="ml-1 text-xs text-block">critical</span> : null}
                          </td>
                          <td className="px-2 py-2 text-muted">{asset.location || "—"}</td>
                          <td className="px-2 py-2 text-muted">{CATEGORY_LABEL[asset.category]}</td>
                          <td className="px-2 py-2">
                            {state.usable ? (
                              <span className="text-good">usable</span>
                            ) : (
                              <span className="text-block">{state.reasons[0]}</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">{formatKes(bookValue(asset))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {configuring ? (
            <Section title="Add an asset" note="A tag is what is painted on the side. A cold chain asset must say which store it holds.">
              <form action={addAssetAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-4">
                <div>
                  <label className={LABEL}>Tag</label>
                  <input name="tag" required className={FIELD} placeholder="OT-AC-02" />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>Name</label>
                  <input name="name" required className={FIELD} placeholder="Autoclave" />
                </div>
                <div>
                  <label className={LABEL}>Kind</label>
                  <select name="category" className={FIELD}>
                    {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Where it lives</label>
                  <input name="location" className={FIELD} placeholder="Theatre" />
                </div>
                <div>
                  <label className={LABEL}>Store it holds (cold chain)</label>
                  <select name="storeCode" className={FIELD}>
                    <option value="">—</option>
                    {stores.map((store) => (
                      <option key={store.code} value={store.code}>{store.code} · {store.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Serial number</label>
                  <input name="serialNo" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Make and model</label>
                  <div className="flex gap-2">
                    <input name="manufacturer" className={FIELD} placeholder="Tuttnauer" />
                    <input name="model" className={FIELD} placeholder="3870EA" />
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Acquired on</label>
                  <input name="acquiredOn" type="date" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Cost (KES)</label>
                  <input name="cost" type="number" step="0.01" min="0" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Useful life (months)</label>
                  <input name="usefulLifeMonths" type="number" min="1" className={FIELD} placeholder="120" />
                </div>
                <div>
                  <label className={LABEL}>Warranty until</label>
                  <input name="warrantyUntil" type="date" className={FIELD} />
                </div>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="critical" />
                  Clinical work depends on this — say so loudly when it goes down
                </label>
                <div className="sm:col-span-4">
                  <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Add to register</button>
                </div>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ================================================== one asset */}
      {view === "register" && open ? (
        <>
          <Section title={`${open.tag} · ${open.name}`}>
            <div className="bg-white border border-line rounded p-3 text-sm">
              <p className="text-muted">
                {CATEGORY_LABEL[open.category]} · {open.location || "no location recorded"}
                {open.manufacturer ? ` · ${open.manufacturer} ${open.model}` : ""}
                {open.serial_no ? ` · serial ${open.serial_no}` : ""}
              </p>
              <p className="mt-2">
                {/* Green only when it is both in service and actually usable: an
                    autoclave whose pressure test has lapsed is administratively
                    in service and clinically refused, and the second is what
                    matters to whoever is reading this. */}
                <span className={open.status === "in_service" && openUsable?.usable ? "text-good" : "text-block"}>
                  {STATUS_LABEL[open.status]}
                  {open.status === "in_service" && openUsable && !openUsable.usable ? ", but not usable" : ""}
                </span>
                {open.status_reason ? <span className="text-muted"> — {open.status_reason}</span> : null}
              </p>
              {openUsable && !openUsable.usable ? (
                <ul className="mt-2 text-block text-sm list-disc pl-5">
                  {openUsable.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              ) : null}
              {openUsable && openUsable.warnings.length > 0 ? (
                <ul className="mt-2 text-clock text-sm list-disc pl-5">
                  {openUsable.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              ) : null}
              <p className="text-xs text-muted mt-2">
                {open.acquired_on ? `Acquired ${open.acquired_on}` : "No acquisition date"} ·
                {open.cost_cents ? ` ${formatKes(open.cost_cents)} at cost · ${formatKes(bookValue(open))} on the books` : " no cost recorded"}
                {open.warranty_until ? ` · warranty to ${open.warranty_until}` : ""}
              </p>
              <p className="mt-2">
                <Link href="/assets?view=register" className="text-brand text-sm hover:underline">← the whole register</Link>
              </p>
            </div>
          </Section>

          <Section title="Scheduled checks">
            {openSchedules.length === 0 ? (
              <Empty>Nothing is scheduled on this asset.</Empty>
            ) : (
              <div className="space-y-3">
                {openSchedules.map((schedule) => (
                  <div key={schedule.id} className="bg-white border border-line rounded p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium text-sm">{schedule.name}</span>
                      <span className="text-xs text-muted">every {schedule.every_days} days</span>
                      {schedule.regulator ? <span className="text-xs text-muted">{schedule.regulator}</span> : null}
                      {schedule.blocks_use ? (
                        <span className="text-xs text-block">stops use when overdue</span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted mt-1">
                      Last done {schedule.last_done_on ?? "never"} · next due {schedule.next_due_on}
                    </p>

                    <form action={maintenanceAction} className="mt-3 grid gap-2 sm:grid-cols-5 items-end">
                      <input type="hidden" name="assetId" value={open.id} />
                      <input type="hidden" name="scheduleId" value={schedule.id} />
                      <input type="hidden" name="kind" value={schedule.kind} />
                      <div>
                        <label className={LABEL}>Done on</label>
                        <input name="doneOn" type="date" defaultValue={today()} className={FIELD} />
                      </div>
                      <div>
                        <label className={LABEL}>Outcome</label>
                        <select name="outcome" className={FIELD}>
                          <option value="passed">Passed</option>
                          <option value="failed">Failed</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className={LABEL}>Findings (required if it failed)</label>
                        <input name="findings" className={FIELD} placeholder="Door seal fails at 1.8 bar" />
                      </div>
                      <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Record</button>
                      <div className="sm:col-span-2">
                        <label className={LABEL}>Who did it</label>
                        <input name="performedBy" className={FIELD} placeholder="Kentronics" />
                      </div>
                      <div>
                        <label className={LABEL}>Certificate</label>
                        <input name="certificate" className={FIELD} />
                      </div>
                      <div>
                        <label className={LABEL}>Cost (KES)</label>
                        <input name="cost" type="number" step="0.01" min="0" className={FIELD} />
                      </div>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {configuring ? (
            <Section title="Schedule a check" note="Blocking is a property of the check, not of the asset: a pressure test blocks, a furniture inspection warns.">
              <form action={scheduleAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-5 items-end">
                <input type="hidden" name="assetId" value={open.id} />
                <div className="sm:col-span-2">
                  <label className={LABEL}>What it is called</label>
                  <input name="name" required className={FIELD} placeholder="Pressure vessel test" />
                </div>
                <div>
                  <label className={LABEL}>Kind</label>
                  <select name="kind" className={FIELD}>
                    <option value="service">Service</option>
                    <option value="calibration">Calibration</option>
                    <option value="safety_test">Safety test</option>
                    <option value="inspection">Inspection</option>
                    <option value="licence">Licence</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Every (days)</label>
                  <input name="everyDays" type="number" min="1" required className={FIELD} placeholder="365" />
                </div>
                <div>
                  <label className={LABEL}>Regulator</label>
                  <input name="regulator" className={FIELD} placeholder="DOSHS" />
                </div>
                <div>
                  <label className={LABEL}>Last done</label>
                  <input name="lastDoneOn" type="date" className={FIELD} />
                </div>
                <label className="flex items-center gap-2 text-sm sm:col-span-3">
                  <input type="checkbox" name="blocksUse" />
                  Overdue means the equipment may not be used
                </label>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Schedule</button>
              </form>
            </Section>
          ) : null}

          <Section title="Report a fault">
            <form action={faultAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-4 items-end">
              <input type="hidden" name="assetId" value={open.id} />
              <div className="sm:col-span-2">
                <label className={LABEL}>What is wrong</label>
                <input name="fault" required className={FIELD} placeholder="Will not crank" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="stillUsable" />
                Still usable meanwhile
              </label>
              <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Report</button>
            </form>
          </Section>

          {openReadings.length > 0 ? (
            <Section title="Temperature log">
              <div className="bg-white border border-line rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                    <tr>
                      <th className="px-3 py-2">Taken</th>
                      <th className="px-2 py-2">Reading</th>
                      <th className="px-2 py-2">What happened</th>
                      <th className="px-2 py-2">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openReadings.map((reading) => (
                      <tr key={reading.taken_at} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap">{reading.taken_at.slice(0, 16).replace("T", " ")}</td>
                        <td className={`px-2 py-2 ${reading.in_range ? "" : "text-block font-medium"}`}>
                          {(reading.reading_tenths / 10).toFixed(1)} °C
                        </td>
                        <td className="px-2 py-2 text-muted">{reading.excursion_action || "—"}</td>
                        <td className="px-2 py-2 text-muted">{reading.taker_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}

          <Section title="History" note="Failed checks stay on the record. They are the rows somebody will come looking for.">
            {openHistory.length === 0 && openOrders.length === 0 ? (
              <Empty>Nothing has been recorded against this asset.</Empty>
            ) : (
              <div className="bg-white border border-line rounded divide-y divide-line">
                {openHistory.map((record) => (
                  <div key={record.id} className="px-3 py-2 text-sm">
                    <span className="text-muted">{record.done_on}</span>{" "}
                    <span className={record.passed ? "text-good" : "text-block font-medium"}>
                      {record.kind.replace("_", " ")} {record.passed ? "passed" : "FAILED"}
                    </span>
                    {record.findings ? <span> — {record.findings}</span> : null}
                    <span className="text-xs text-muted">
                      {record.performed_by ? ` · ${record.performed_by}` : ""}
                      {record.certificate ? ` · cert ${record.certificate}` : ""}
                      {record.cost_cents ? ` · ${formatKes(record.cost_cents)}` : ""}
                      {` · recorded by ${record.creator_name}`}
                    </span>
                  </div>
                ))}
                {openOrders.map((order) => (
                  <div key={order.id} className="px-3 py-2 text-sm">
                    <span className="text-muted">{order.reported_at.slice(0, 10)}</span>{" "}
                    <span className="font-medium">fault</span> — {order.fault}
                    <span className="text-xs text-muted">
                      {" "}· {order.status.replace("_", " ")}
                      {order.resolution ? ` · ${order.resolution}` : ""}
                      {order.cost_cents ? ` · ${formatKes(order.cost_cents)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {configuring ? (
            <Section title="Change its standing">
              <form action={statusAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-4 items-end">
                <input type="hidden" name="assetId" value={open.id} />
                <div>
                  <label className={LABEL}>Standing</label>
                  <select name="status" className={FIELD}>
                    <option value="in_service">In service</option>
                    <option value="out_of_service">Out of service</option>
                    <option value="under_repair">Under repair</option>
                    <option value="disposed">Disposed</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>Why</label>
                  <input name="reason" required className={FIELD} placeholder="Sold to Kayole Dispensary" />
                </div>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Change</button>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ======================================================= value */}
      {view === "value" ? (
        <Section
          title="Value and depreciation"
          note="Straight line over the useful life, on the same basis the ledger posts. Running it twice does nothing."
        >
          <div className="bg-white border border-line rounded overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                <tr>
                  <th className="px-3 py-2">Tag</th>
                  <th className="px-2 py-2">Asset</th>
                  <th className="px-2 py-2">Acquired</th>
                  <th className="px-2 py-2 text-right">Cost</th>
                  <th className="px-2 py-2 text-right">Life</th>
                  <th className="px-2 py-2 text-right">On the books</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{asset.tag}</td>
                    <td className="px-2 py-2">{asset.name}</td>
                    <td className="px-2 py-2 text-muted whitespace-nowrap">{asset.acquired_on ?? "—"}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {asset.cost_cents ? formatKes(asset.cost_cents) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right text-muted">
                      {asset.useful_life_months ? `${asset.useful_life_months} mo` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatKes(bookValue(asset))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {configuring ? (
            <form action={depreciationAction} className="mt-3 bg-white border border-line rounded p-3 flex flex-wrap gap-2 items-end">
              <div>
                <label className={LABEL}>Period</label>
                <input name="period" defaultValue={period} pattern="\d{4}-\d{2}" required className={`${FIELD} w-40`} />
              </div>
              <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Post depreciation</button>
              <p className="text-xs text-muted w-full">
                Posts to the general ledger against accumulated depreciation, so the register and the books
                cannot drift into two different answers.
              </p>
            </form>
          ) : null}
        </Section>
      ) : null}
    </Shell>
  );
}

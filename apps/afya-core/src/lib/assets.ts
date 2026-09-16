/**
 * M63 Assets & Maintenance.
 *
 * An asset register is the boring half of this module. The half that matters is
 * that some of this equipment must not be used when a check is overdue, and one
 * of it can ruin everything inside it without anybody noticing.
 *
 *  AN OVERDUE BLOCKING CHECK STOPS THE ASSET BEING USED. An autoclave past its
 *  pressure test is not a maintenance backlog item, it is a theatre that should
 *  not open. `usable()` answers that question and the theatre and radiology
 *  screens can ask it before a list starts. Blocking is a property of the check
 *  and not of the asset: a pressure test or a radiation licence blocks, a
 *  furniture inspection warns, because a chair with a late inspection is not a
 *  chair nobody may sit in. What criticality decides is how loudly the facility
 *  is told — a critical asset out of service raises an alert and sorts to the
 *  top of the board.
 *
 *  A CHECK THAT WAS DONE AND FAILED IS THE MOST IMPORTANT ROW IN THE TABLE. A
 *  system that records only successful maintenance hides exactly the thing
 *  somebody needs to find. A failed check does not advance the next due date,
 *  and it takes the asset out of service if the check blocks use.
 *
 *  A COLD CHAIN EXCURSION QUARANTINES WHAT IS IN THE FRIDGE. This is the one
 *  place this module reaches into another: a vaccine fridge that spent the
 *  night at fourteen degrees has ruined what is inside it, and the batches are
 *  quarantined automatically rather than waiting for somebody to connect the
 *  temperature log to the stock. A nurse must not be able to draw up a vaccine
 *  from a fridge that failed, and the only reliable way to stop her is to make
 *  the stock unpickable the moment the reading is recorded.
 *
 *  DOWNTIME IS MEASURED FROM WHEN IT WAS REPORTED. Not from when somebody got
 *  round to writing a work order, which is the number a maintenance department
 *  would rather report.
 *
 * ⚠️ The temperature range, the schedule intervals and which assets count as
 * critical are all facility decisions. The seeded values are conventions, and
 * the review register says which.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { notify } from "./notifications.ts";
import { quarantineBatch, pickable } from "./inventory.ts";
import { getProduct } from "./prescribing.ts";
import { postJournal, ACCOUNT } from "./accounting.ts";
import { formatKes } from "./billing.ts";
import { number as configNumber } from "./configuration.ts";

export class AssetError extends Error {}

export type AssetCategory = "equipment" | "vehicle" | "furniture" | "building" | "it" | "cold_chain";
export type AssetStatus = "in_service" | "out_of_service" | "under_repair" | "disposed";
export type ScheduleKind = "service" | "calibration" | "safety_test" | "inspection" | "licence";
export type WorkOrderStatus = "open" | "in_progress" | "fixed" | "beyond_repair" | "cancelled";

/**
 * The range a vaccine fridge must stay within, in tenths of a degree.
 *
 * ⚠️ 2 to 8 °C is the WHO cold chain range for most vaccines and is what KEPI
 * works to. Some products differ, and a facility storing them needs its own
 * range per asset — which this module does not yet support.
 */
export const COLD_CHAIN_RANGE_DEFAULT = { minTenths: 20, maxTenths: 80 };

/** The range in force, which a facility may change with a source recorded. */
export function coldChainRange(): { minTenths: number; maxTenths: number } {
  return {
    minTenths: configNumber("cold_chain.min_tenths"),
    maxTenths: configNumber("cold_chain.max_tenths"),
  };
}

/** How far ahead a due check is worth seeing. */
export const DUE_HORIZON_DAYS_DEFAULT = 30;

/** How far ahead a due check is worth seeing, as the facility has it. */
export function dueHorizonDays(): number {
  return configNumber("assets.due_horizon_days");
}

export interface Asset {
  id: string;
  facility_id: number;
  tag: string;
  name: string;
  category: AssetCategory;
  location: string;
  store_code: string | null;
  serial_no: string;
  manufacturer: string;
  model: string;
  critical: number;
  status: AssetStatus;
  status_reason: string;
  acquired_on: string | null;
  cost_cents: number | null;
  useful_life_months: number | null;
  supplier_code: string | null;
  warranty_until: string | null;
  service_contract: string;
  disposed_on: string | null;
  disposal_note: string;
}

// ------------------------------------------------------------------ assets

export function addAsset(input: {
  facilityId: number;
  tag: string;
  name: string;
  category?: AssetCategory;
  location?: string;
  storeCode?: string;
  serialNo?: string;
  manufacturer?: string;
  model?: string;
  critical?: boolean;
  acquiredOn?: string;
  costCents?: number;
  usefulLifeMonths?: number;
  supplierCode?: string;
  warrantyUntil?: string;
  serviceContract?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  if (!input.tag.trim()) throw new AssetError("an asset needs a tag — it is what is painted on the side");
  if (!input.name.trim()) throw new AssetError("an asset needs a name");
  if (input.category === "cold_chain" && !input.storeCode) {
    // Without knowing which store it holds, a fridge excursion cannot reach
    // the stock, and the whole point of tracking it is lost.
    throw new AssetError("a cold chain asset must say which store it holds, or an excursion cannot reach the stock");
  }

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO assets
         (id, facility_id, tag, name, category, location, store_code, serial_no, manufacturer,
          model, critical, status, acquired_on, cost_cents, useful_life_months, supplier_code,
          warranty_until, service_contract, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_service', ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.facilityId,
      input.tag.trim().toUpperCase(),
      input.name.trim(),
      input.category ?? "equipment",
      input.location?.trim() ?? "",
      input.storeCode?.trim().toUpperCase() ?? null,
      input.serialNo?.trim() ?? "",
      input.manufacturer?.trim() ?? "",
      input.model?.trim() ?? "",
      input.critical ? 1 : 0,
      input.acquiredOn ?? null,
      input.costCents ?? null,
      input.usefulLifeMonths ?? null,
      input.supplierCode?.trim().toUpperCase() ?? null,
      input.warrantyUntil ?? null,
      input.serviceContract?.trim() ?? "",
      now(),
    );
    audit({
      action: "asset_added",
      entity: "asset",
      entityId: id,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { tag: input.tag, name: input.name, critical: Boolean(input.critical), costCents: input.costCents ?? null },
    });
    return id;
  });
}

export function getAsset(id: string): Asset | undefined {
  return get<Asset>(`SELECT * FROM assets WHERE id = ?`, id);
}

export function assetByTag(facilityId: number, tag: string): Asset | undefined {
  return get<Asset>(
    `SELECT * FROM assets WHERE facility_id = ? AND tag = ?`,
    facilityId,
    tag.trim().toUpperCase(),
  );
}

export function listAssets(facilityId: number, includeDisposed = false): Asset[] {
  return all<Asset>(
    `SELECT * FROM assets WHERE facility_id = ? ${includeDisposed ? "" : "AND status <> 'disposed'"}
      ORDER BY tag`,
    facilityId,
  );
}

export function setAssetStatus(input: {
  assetId: string;
  status: AssetStatus;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const asset = getAsset(input.assetId);
  if (!asset) throw new AssetError("no such asset");
  if (asset.status === "disposed") throw new AssetError("that asset has been disposed of");
  if (!input.reason.trim()) throw new AssetError("changing an asset's status must record why");

  tx(() => {
    run(
      `UPDATE assets SET status = ?, status_reason = ?, disposed_on = ?, disposal_note = ? WHERE id = ?`,
      input.status,
      input.reason.trim(),
      input.status === "disposed" ? today() : asset.disposed_on,
      input.status === "disposed" ? input.reason.trim() : asset.disposal_note,
      asset.id,
    );
    audit({
      action: input.status === "disposed" ? "asset_disposed" : "asset_status_changed",
      entity: "asset",
      entityId: asset.id,
      facilityId: asset.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { tag: asset.tag, from: asset.status, to: input.status, reason: input.reason },
    });
  });
}

// --------------------------------------------------------------- schedules

export function scheduleMaintenance(input: {
  assetId: string;
  kind: ScheduleKind;
  name: string;
  everyDays: number;
  regulator?: string;
  blocksUse?: boolean;
  lastDoneOn?: string;
  nextDueOn?: string;
  note?: string;
  deviceCode: string;
}): string {
  const asset = getAsset(input.assetId);
  if (!asset) throw new AssetError("no such asset");
  if (!Number.isInteger(input.everyDays) || input.everyDays <= 0) {
    throw new AssetError("a schedule interval is a whole number of days above zero");
  }

  const id = mintLocalId(input.deviceCode, 8);
  const nextDue =
    input.nextDueOn ??
    (input.lastDoneOn
      ? addDays(input.lastDoneOn, input.everyDays)
      : addDays(today(), input.everyDays));

  run(
    `INSERT INTO maintenance_schedules
       (id, asset_id, kind, name, every_days, regulator, blocks_use, last_done_on, next_due_on, note, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    id,
    asset.id,
    input.kind,
    input.name.trim(),
    input.everyDays,
    input.regulator?.trim() ?? "",
    input.blocksUse ? 1 : 0,
    input.lastDoneOn ?? null,
    nextDue,
    input.note?.trim() ?? "",
    now(),
  );
  return id;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function schedulesFor(assetId: string) {
  return all<{
    id: string;
    kind: ScheduleKind;
    name: string;
    every_days: number;
    regulator: string;
    blocks_use: number;
    last_done_on: string | null;
    next_due_on: string;
    note: string;
    active: number;
  }>(`SELECT * FROM maintenance_schedules WHERE asset_id = ? AND active = 1 ORDER BY next_due_on`, assetId);
}

/**
 * Record a maintenance event.
 *
 * A failed check does not advance the next due date — the work still has to be
 * done — and it takes the asset out of service where the check blocks use.
 */
export function recordMaintenance(input: {
  assetId: string;
  scheduleId?: string;
  kind: ScheduleKind;
  doneOn?: string;
  passed?: boolean;
  findings?: string;
  certificate?: string;
  performedBy?: string;
  costCents?: number;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const asset = getAsset(input.assetId);
  if (!asset) throw new AssetError("no such asset");

  const passed = input.passed !== false;
  if (!passed && !input.findings?.trim()) {
    throw new AssetError("a failed check must record what was found — that is the whole value of recording it");
  }

  const schedule = input.scheduleId
    ? schedulesFor(asset.id).find((s) => s.id === input.scheduleId)
    : undefined;
  if (input.scheduleId && !schedule) throw new AssetError("no such schedule on this asset");

  const id = mintLocalId(input.deviceCode, 8);
  const doneOn = input.doneOn ?? today();

  return tx(() => {
    run(
      `INSERT INTO maintenance_records
         (id, asset_id, schedule_id, kind, done_on, passed, findings, certificate,
          performed_by, cost_cents, created_by, creator_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      asset.id,
      schedule?.id ?? null,
      input.kind,
      doneOn,
      passed ? 1 : 0,
      input.findings?.trim() ?? "",
      input.certificate?.trim() ?? "",
      input.performedBy?.trim() ?? "",
      input.costCents ?? null,
      input.byUserId,
      input.byUserName,
      now(),
    );

    if (schedule) {
      if (passed) {
        run(
          `UPDATE maintenance_schedules SET last_done_on = ?, next_due_on = ? WHERE id = ?`,
          doneOn,
          addDays(doneOn, schedule.every_days),
          schedule.id,
        );
      } else if (schedule.blocks_use) {
        // A failed blocking check takes the asset out of service. The due date
        // is NOT advanced: the work still has to be done.
        run(
          `UPDATE assets SET status = 'out_of_service', status_reason = ? WHERE id = ?`,
          `Failed ${schedule.name} on ${doneOn}: ${input.findings?.trim()}`,
          asset.id,
        );
        notify({
          facilityId: asset.facility_id,
          ownerRole: "admin",
          severity: "critical",
          kind: "asset_failed_check",
          subject: `${asset.name} (${asset.tag}) failed its ${schedule.name} and is out of service`,
          body: input.findings?.trim() ?? "",
          entity: "asset",
          entityId: asset.id,
          dedupeKey: `asset_failed:${id}`,
        });
      }
    }

    audit({
      action: passed ? "maintenance_recorded" : "maintenance_failed",
      entity: "asset",
      entityId: asset.id,
      facilityId: asset.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: {
        tag: asset.tag,
        kind: input.kind,
        schedule: schedule?.name ?? null,
        passed,
        findings: input.findings ?? null,
        certificate: input.certificate ?? null,
      },
    });
    return id;
  });
}

export function maintenanceFor(assetId: string, limit = 30) {
  return all<{
    id: string;
    kind: string;
    done_on: string;
    passed: number;
    findings: string;
    certificate: string;
    performed_by: string;
    cost_cents: number | null;
    creator_name: string;
  }>(`SELECT * FROM maintenance_records WHERE asset_id = ? ORDER BY done_on DESC LIMIT ?`, assetId, limit);
}

// ------------------------------------------------------------- usability

export interface Usability {
  usable: boolean;
  /** Why not, in the words a theatre or a radiographer would use. */
  reasons: string[];
  /** Overdue checks that do not block, which are still worth saying. */
  warnings: string[];
}

/**
 * Whether this asset may be used right now.
 *
 * The question a theatre list or an imaging request should ask before it
 * starts. An autoclave past its pressure test is not a maintenance backlog
 * item — it is a theatre that should not open.
 */
export function usable(assetId: string, asOf = today()): Usability {
  const asset = getAsset(assetId);
  if (!asset) throw new AssetError("no such asset");

  const reasons: string[] = [];
  const warnings: string[] = [];

  if (asset.status === "disposed") reasons.push("disposed of");
  if (asset.status === "out_of_service") reasons.push(`out of service — ${asset.status_reason}`);
  if (asset.status === "under_repair") reasons.push(`under repair — ${asset.status_reason}`);

  const open = all<{ fault: string; out_of_service: number }>(
    `SELECT fault, out_of_service FROM work_orders WHERE asset_id = ? AND status IN ('open','in_progress')`,
    asset.id,
  );
  for (const order of open) {
    if (order.out_of_service) reasons.push(`fault reported: ${order.fault}`);
    else warnings.push(`fault reported, still usable: ${order.fault}`);
  }

  for (const schedule of schedulesFor(asset.id)) {
    if (schedule.next_due_on >= asOf) continue;
    const overdueBy = Math.round(
      (Date.parse(`${asOf}T00:00:00.000Z`) - Date.parse(`${schedule.next_due_on}T00:00:00.000Z`)) / 86_400_000,
    );
    const said = `${schedule.name} overdue by ${overdueBy} day${overdueBy === 1 ? "" : "s"}${
      schedule.regulator ? ` (${schedule.regulator})` : ""
    }`;
    // Blocking is the schedule's own property, not the asset's: a chair with a
    // late inspection is not a chair nobody may sit in.
    if (schedule.blocks_use) reasons.push(said);
    else warnings.push(said);
  }

  return { usable: reasons.length === 0, reasons, warnings };
}

// --------------------------------------------------- what depends on what

export type DependencyKind = "theatre" | "modality" | "store";

/**
 * Say that a room or a modality cannot work without a particular asset.
 *
 * This is what turns `usable()` from an answer into a control. Until something
 * asked it, an autoclave past its pressure test was a red line on a screen and
 * the theatre list went on as before.
 */
export function dependsOn(input: {
  kind: DependencyKind;
  ref: string;
  assetId: string;
  why?: string;
}): void {
  const asset = getAsset(input.assetId);
  if (!asset) throw new AssetError("no such asset");
  run(
    `INSERT INTO equipment_dependencies (kind, ref, asset_id, why, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(kind, ref, asset_id) DO UPDATE SET why = excluded.why`,
    input.kind,
    input.ref.trim().toUpperCase(),
    asset.id,
    input.why?.trim() ?? "",
    now(),
  );
}

export function dependenciesFor(kind: DependencyKind, ref: string) {
  return all<{ id: number; asset_id: string; why: string; tag: string; name: string }>(
    `SELECT d.id, d.asset_id, d.why, a.tag, a.name
       FROM equipment_dependencies d JOIN assets a ON a.id = d.asset_id
      WHERE d.kind = ? AND d.ref = ? ORDER BY a.tag`,
    kind,
    ref.trim().toUpperCase(),
  );
}

/**
 * Why this room or modality cannot be used, or nothing.
 *
 * The one line a theatre list or an imaging worklist puts on the screen. Only
 * blocking reasons count: a fault reported as still usable and an overdue
 * furniture inspection do not stop a list, and saying they did would teach
 * everybody to ignore the line.
 */
export function equipmentBlock(kind: DependencyKind, ref: string, asOf = today()): string | null {
  for (const dependency of dependenciesFor(kind, ref)) {
    const state = usable(dependency.asset_id, asOf);
    if (!state.usable) {
      return `${dependency.tag} ${dependency.name.toLowerCase()}${
        dependency.why ? ` (${dependency.why})` : ""
      }: ${state.reasons[0]}`;
    }
  }
  return null;
}

// ------------------------------------------------------------ work orders

export function reportFault(input: {
  assetId: string;
  fault: string;
  outOfService?: boolean;
  reportedAt?: string;
  byUserId: number | null;
  byUserName: string;
  deviceCode: string;
}): string {
  const asset = getAsset(input.assetId);
  if (!asset) throw new AssetError("no such asset");
  if (asset.status === "disposed") throw new AssetError("that asset has been disposed of");
  if (!input.fault.trim()) throw new AssetError("a fault report must say what is wrong");

  const id = mintLocalId(input.deviceCode, 8);
  const outOfService = input.outOfService !== false;

  return tx(() => {
    run(
      `INSERT INTO work_orders
         (id, asset_id, fault, reported_at, reported_by, reporter_name, out_of_service,
          status, under_warranty, device_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      id,
      asset.id,
      input.fault.trim(),
      input.reportedAt ?? now(),
      input.byUserId,
      input.byUserName,
      outOfService ? 1 : 0,
      // Recorded at the moment of reporting, from the warranty date then —
      // working it out afterwards is how a facility pays for a repair it was
      // owed free.
      asset.warranty_until && asset.warranty_until >= today() ? 1 : 0,
      input.deviceCode,
      now(),
    );

    if (outOfService) {
      run(
        `UPDATE assets SET status = 'under_repair', status_reason = ? WHERE id = ?`,
        input.fault.trim(),
        asset.id,
      );
      if (asset.critical) {
        notify({
          facilityId: asset.facility_id,
          ownerRole: "admin",
          severity: "critical",
          kind: "asset_down",
          subject: `${asset.name} (${asset.tag}) is down — ${input.fault.trim()}`,
          body: `${asset.location || "no location recorded"}. This is equipment clinical work depends on.`,
          entity: "asset",
          entityId: asset.id,
          dedupeKey: `asset_down:${id}`,
        });
      }
    }

    audit({
      action: "fault_reported",
      entity: "asset",
      entityId: asset.id,
      facilityId: asset.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      deviceCode: input.deviceCode,
      detail: { tag: asset.tag, fault: input.fault, outOfService, critical: Boolean(asset.critical) },
    });
    return id;
  });
}

export function closeWorkOrder(input: {
  workOrderId: string;
  status: Extract<WorkOrderStatus, "fixed" | "beyond_repair" | "cancelled">;
  resolution: string;
  costCents?: number;
  assignedTo?: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const order = getWorkOrder(input.workOrderId);
  if (!order) throw new AssetError("no such work order");
  if (order.status !== "open" && order.status !== "in_progress") {
    throw new AssetError(`that work order is already ${order.status.replace("_", " ")}`);
  }
  if (!input.resolution.trim()) throw new AssetError("closing a work order must say what was done");

  const asset = getAsset(order.asset_id)!;
  const closedAt = now();

  tx(() => {
    run(
      `UPDATE work_orders SET status = ?, resolution = ?, cost_cents = ?, assigned_to = ?, closed_at = ? WHERE id = ?`,
      input.status,
      input.resolution.trim(),
      input.costCents ?? null,
      input.assignedTo?.trim() ?? order.assigned_to,
      closedAt,
      order.id,
    );

    if (input.status === "fixed") {
      // Back in service only if nothing else is holding it out.
      const others = all<{ id: string }>(
        `SELECT id FROM work_orders WHERE asset_id = ? AND id <> ? AND status IN ('open','in_progress') AND out_of_service = 1`,
        asset.id,
        order.id,
      );
      if (others.length === 0 && asset.status === "under_repair") {
        run(`UPDATE assets SET status = 'in_service', status_reason = '' WHERE id = ?`, asset.id);
      }
    } else if (input.status === "beyond_repair") {
      run(
        `UPDATE assets SET status = 'out_of_service', status_reason = ? WHERE id = ?`,
        `Beyond repair: ${input.resolution.trim()}`,
        asset.id,
      );
    }

    // A bill on a machine under warranty is money the facility should not have
    // paid, and saying so afterwards is too late to be useful — so it is on
    // the audit entry where a review will find it.
    audit({
      action: "work_order_closed",
      entity: "asset",
      entityId: asset.id,
      facilityId: asset.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: {
        tag: asset.tag,
        status: input.status,
        downtimeHours: Math.round((Date.parse(closedAt) - Date.parse(order.reported_at)) / 3_600_000),
        costCents: input.costCents ?? null,
        underWarranty: Boolean(order.under_warranty),
        paidUnderWarranty: Boolean(order.under_warranty) && (input.costCents ?? 0) > 0,
      },
    });
  });
}

export function getWorkOrder(id: string) {
  return get<{
    id: string;
    asset_id: string;
    fault: string;
    reported_at: string;
    reporter_name: string;
    out_of_service: number;
    status: WorkOrderStatus;
    assigned_to: string;
    under_warranty: number;
    cost_cents: number | null;
    resolution: string;
    closed_at: string | null;
  }>(`SELECT * FROM work_orders WHERE id = ?`, id);
}

export function workOrdersFor(assetId: string) {
  return all<{
    id: string;
    fault: string;
    reported_at: string;
    reporter_name: string;
    out_of_service: number;
    status: WorkOrderStatus;
    under_warranty: number;
    cost_cents: number | null;
    resolution: string;
    closed_at: string | null;
  }>(`SELECT * FROM work_orders WHERE asset_id = ? ORDER BY reported_at DESC`, assetId);
}

export interface OpenFault {
  workOrderId: string;
  assetId: string;
  tag: string;
  name: string;
  location: string;
  critical: boolean;
  fault: string;
  reportedAt: string;
  reporterName: string;
  /** Hours since it was reported, not since somebody wrote a work order. */
  downHours: number;
  outOfService: boolean;
  underWarranty: boolean;
}

export function openFaults(facilityId: number, asOf = now()): OpenFault[] {
  return all<{
    id: string;
    asset_id: string;
    tag: string;
    name: string;
    location: string;
    critical: number;
    fault: string;
    reported_at: string;
    reporter_name: string;
    out_of_service: number;
    under_warranty: number;
  }>(
    `SELECT w.id, w.asset_id, a.tag, a.name, a.location, a.critical, w.fault,
            w.reported_at, w.reporter_name, w.out_of_service, w.under_warranty
       FROM work_orders w JOIN assets a ON a.id = w.asset_id
      WHERE a.facility_id = ? AND w.status IN ('open','in_progress')`,
    facilityId,
  )
    .map((w) => ({
      workOrderId: w.id,
      assetId: w.asset_id,
      tag: w.tag,
      name: w.name,
      location: w.location,
      critical: w.critical === 1,
      fault: w.fault,
      reportedAt: w.reported_at,
      reporterName: w.reporter_name,
      downHours: Math.max(0, Math.round((Date.parse(asOf) - Date.parse(w.reported_at)) / 3_600_000)),
      outOfService: w.out_of_service === 1,
      underWarranty: w.under_warranty === 1,
    }))
    .sort((a, b) => Number(b.critical) - Number(a.critical) || b.downHours - a.downHours);
}

// ------------------------------------------------------------- cold chain

/**
 * Record a fridge temperature, and act on it.
 *
 * An out-of-range reading quarantines every batch in that store. This is the
 * one place this module reaches into another, and it is deliberate: a nurse
 * must not be able to draw up a vaccine from a fridge that failed overnight,
 * and the only reliable way to stop her is to make the stock unpickable the
 * moment the reading is recorded. Waiting for somebody to connect the
 * temperature log to the stock is how spoiled vaccine gets given.
 */
export function recordTemperature(input: {
  assetId: string;
  readingTenths: number;
  takenAt?: string;
  byUserId: number | null;
  byUserName: string;
}): { inRange: boolean; quarantined: number } {
  const asset = getAsset(input.assetId);
  if (!asset) throw new AssetError("no such asset");
  if (asset.category !== "cold_chain") throw new AssetError("that asset is not a cold chain asset");
  if (!Number.isInteger(input.readingTenths) || input.readingTenths < -400 || input.readingTenths > 600) {
    throw new AssetError("that reading is outside anything a fridge could show — check for a transposed digit");
  }

  const range = coldChainRange();
  const inRange =
    input.readingTenths >= range.minTenths && input.readingTenths <= range.maxTenths;
  const takenAt = input.takenAt ?? now();
  let quarantined = 0;

  return tx(() => {
    let action = "";

    if (!inRange && asset.store_code) {
      const reason = `Cold chain excursion in ${asset.name} (${asset.tag}): ${(input.readingTenths / 10).toFixed(1)} °C at ${takenAt.slice(11, 16)}`;
      // Every batch in that store, not only the vaccines: whatever was in the
      // fridge was at that temperature.
      const batches = all<{ id: string }>(
        `SELECT b.id FROM stock_batches b
          WHERE b.store_code = ? AND b.quarantined = 0 AND b.quantity > 0`,
        asset.store_code,
      );
      for (const batch of batches) {
        quarantineBatch({
          batchId: batch.id,
          reason,
          byUserId: input.byUserId,
          byUserName: input.byUserName,
        });
        quarantined++;
      }
      action = `${quarantined} batch${quarantined === 1 ? "" : "es"} quarantined`;

      notify({
        facilityId: asset.facility_id,
        ownerRole: "pharmacist",
        severity: "critical",
        kind: "cold_chain_excursion",
        subject: `${asset.name} at ${(input.readingTenths / 10).toFixed(1)} °C — ${action}`,
        body: `Range is ${range.minTenths / 10} to ${range.maxTenths / 10} °C. The stock is quarantined and cannot be picked. Assess each batch against its own stability data before releasing anything.`,
        entity: "asset",
        entityId: asset.id,
        dedupeKey: `cold_chain:${asset.id}:${takenAt.slice(0, 13)}`,
      });
    }

    run(
      `INSERT INTO temperature_readings
         (asset_id, reading_tenths, taken_at, in_range, excursion_action, taken_by, taker_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      asset.id,
      input.readingTenths,
      takenAt,
      inRange ? 1 : 0,
      action,
      input.byUserId,
      input.byUserName,
      now(),
    );

    if (!inRange) {
      audit({
        action: "cold_chain_excursion",
        entity: "asset",
        entityId: asset.id,
        facilityId: asset.facility_id,
        actorId: input.byUserId,
        actorName: input.byUserName,
        purpose: "administration",
        detail: {
          tag: asset.tag,
          readingTenths: input.readingTenths,
          store: asset.store_code,
          batchesQuarantined: quarantined,
        },
      });
    }

    return { inRange, quarantined };
  });
}

export function temperatureLog(assetId: string, limit = 60) {
  return all<{
    reading_tenths: number;
    taken_at: string;
    in_range: number;
    excursion_action: string;
    taker_name: string;
  }>(`SELECT * FROM temperature_readings WHERE asset_id = ? ORDER BY taken_at DESC LIMIT ?`, assetId, limit);
}

/** Cold chain assets and when they were last read. */
export function coldChainBoard(facilityId: number, asOf = now()) {
  return listAssets(facilityId)
    .filter((a) => a.category === "cold_chain")
    .map((a) => {
      const last = get<{ reading_tenths: number; taken_at: string; in_range: number }>(
        `SELECT reading_tenths, taken_at, in_range FROM temperature_readings
          WHERE asset_id = ? ORDER BY taken_at DESC LIMIT 1`,
        a.id,
      );
      const hoursSince = last
        ? Math.round((Date.parse(asOf) - Date.parse(last.taken_at)) / 3_600_000)
        : null;
      const stock = a.store_code
        ? get<{ n: number; quarantined: number }>(
            `SELECT COUNT(*) AS n, SUM(quarantined) AS quarantined FROM stock_batches
              WHERE store_code = ? AND quantity > 0`,
            a.store_code,
          )
        : undefined;
      return {
        asset: a,
        lastReadingTenths: last?.reading_tenths ?? null,
        lastTakenAt: last?.taken_at ?? null,
        inRange: last ? last.in_range === 1 : null,
        hoursSinceReading: hoursSince,
        // A fridge nobody has read since yesterday is a fridge nobody is
        // watching, whatever the last reading said.
        overdueReading: hoursSince === null || hoursSince > 24,
        batches: stock?.n ?? 0,
        quarantinedBatches: stock?.quarantined ?? 0,
      };
    });
}

// ------------------------------------------------------------ depreciation

/**
 * Post a month's depreciation.
 *
 * Straight line over the useful life. Idempotent on the period, like every
 * other posting into the ledger, so running it twice does nothing.
 */
export function postDepreciation(input: {
  facilityId: number;
  period: string;
  byUserId: number | null;
  byUserName: string;
}): { assets: number; amountCents: number; journalId: string | null } {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new AssetError("a depreciation period is YYYY-MM");

  const assets = listAssets(input.facilityId).filter(
    (a) => a.cost_cents && a.useful_life_months && a.acquired_on && a.status !== "disposed",
  );

  let total = 0;
  let counted = 0;
  const lastDay = `${input.period}-28`;

  for (const asset of assets) {
    // Nothing depreciates before it arrives, and nothing depreciates past the
    // end of its life.
    const monthsOwned = monthsBetween(asset.acquired_on!, `${input.period}-01`);
    if (monthsOwned < 0 || monthsOwned >= asset.useful_life_months!) continue;
    total += Math.round(asset.cost_cents! / asset.useful_life_months!);
    counted++;
  }

  if (total === 0) return { assets: 0, amountCents: 0, journalId: null };

  const journalId = postJournal({
    facilityId: input.facilityId,
    entryDate: lastDay,
    narrative: `Depreciation for ${input.period}`,
    sourceKind: "depreciation",
    sourceRef: `${input.facilityId}:${input.period}`,
    lines: [
      { accountCode: ACCOUNT.EXPENSE_DEPRECIATION, debitCents: total, memo: `${counted} assets` },
      { accountCode: ACCOUNT.ACCUMULATED_DEPRECIATION, creditCents: total, memo: "accumulated depreciation" },
    ],
    byUserId: input.byUserId,
    byUserName: input.byUserName,
  });

  return { assets: counted, amountCents: total, journalId };
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * What an asset is worth on the books today.
 *
 * Same straight line and same per-month rounding as `postDepreciation`, so the
 * register and the ledger cannot drift into two different answers — which is
 * the usual reason an asset register stops being believed.
 */
export function bookValue(asset: Asset, asOf = today()): number {
  if (!asset.cost_cents || !asset.useful_life_months || !asset.acquired_on) return 0;
  if (asset.status === "disposed") return 0;
  const months = Math.min(
    Math.max(monthsBetween(asset.acquired_on, `${asOf.slice(0, 7)}-01`), 0),
    asset.useful_life_months,
  );
  const perMonth = Math.round(asset.cost_cents / asset.useful_life_months);
  return Math.max(asset.cost_cents - perMonth * months, 0);
}

// ------------------------------------------------------------------ reports

export interface AssetSummary {
  assets: number;
  critical: number;
  inService: number;
  outOfService: number;
  underRepair: number;
  openFaults: number;
  criticalDown: number;
  /** Overdue checks that stop an asset being used. */
  blockingOverdue: number;
  dueSoon: number;
  coldChainAssets: number;
  coldChainOutOfRange: number;
  coldChainUnread: number;
  quarantinedBatches: number;
  /** What the register cost, before anything wore out. */
  costCents: number;
  /** Cost less straight-line depreciation to date, on the same basis as the ledger. */
  bookValueCents: number;
  /** Repairs paid for on equipment that was under warranty. */
  paidUnderWarranty: number;
}

export function assetSummary(facilityId: number, asOf = today()): AssetSummary {
  const assets = listAssets(facilityId);
  const faults = openFaults(facilityId);
  const cold = coldChainBoard(facilityId);

  const horizon = addDays(asOf, dueHorizonDays());
  const schedules = all<{ asset_id: string; blocks_use: number; next_due_on: string }>(
    `SELECT s.asset_id, s.blocks_use, s.next_due_on
       FROM maintenance_schedules s JOIN assets a ON a.id = s.asset_id
      WHERE a.facility_id = ? AND s.active = 1 AND a.status <> 'disposed'`,
    facilityId,
  );

  const paidUnderWarranty =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM work_orders w JOIN assets a ON a.id = w.asset_id
        WHERE a.facility_id = ? AND w.under_warranty = 1 AND COALESCE(w.cost_cents, 0) > 0`,
      facilityId,
    )?.n ?? 0;

  return {
    assets: assets.length,
    critical: assets.filter((a) => a.critical).length,
    inService: assets.filter((a) => a.status === "in_service").length,
    outOfService: assets.filter((a) => a.status === "out_of_service").length,
    underRepair: assets.filter((a) => a.status === "under_repair").length,
    openFaults: faults.length,
    criticalDown: faults.filter((f) => f.critical && f.outOfService).length,
    blockingOverdue: schedules.filter((s) => s.blocks_use === 1 && s.next_due_on < asOf).length,
    dueSoon: schedules.filter((s) => s.next_due_on >= asOf && s.next_due_on <= horizon).length,
    coldChainAssets: cold.length,
    coldChainOutOfRange: cold.filter((c) => c.inRange === false).length,
    coldChainUnread: cold.filter((c) => c.overdueReading).length,
    quarantinedBatches: cold.reduce((sum, c) => sum + c.quarantinedBatches, 0),
    costCents: assets.reduce((sum, a) => sum + (a.cost_cents ?? 0), 0),
    bookValueCents: assets.reduce((sum, a) => sum + bookValue(a, asOf), 0),
    paidUnderWarranty,
  };
}

export interface DueRow {
  assetId: string;
  tag: string;
  name: string;
  location: string;
  critical: boolean;
  scheduleId: string;
  scheduleName: string;
  kind: ScheduleKind;
  regulator: string;
  blocksUse: boolean;
  nextDueOn: string;
  daysLeft: number;
  overdue: boolean;
}

/** Everything due or overdue, blocking checks first. */
export function maintenanceDue(facilityId: number, withinDays = dueHorizonDays(), asOf = today()): DueRow[] {
  const horizon = addDays(asOf, withinDays);
  return all<{
    asset_id: string;
    tag: string;
    name: string;
    location: string;
    critical: number;
    schedule_id: string;
    schedule_name: string;
    kind: ScheduleKind;
    regulator: string;
    blocks_use: number;
    next_due_on: string;
  }>(
    `SELECT a.id AS asset_id, a.tag, a.name, a.location, a.critical,
            s.id AS schedule_id, s.name AS schedule_name, s.kind, s.regulator,
            s.blocks_use, s.next_due_on
       FROM maintenance_schedules s JOIN assets a ON a.id = s.asset_id
      WHERE a.facility_id = ? AND s.active = 1 AND a.status <> 'disposed' AND s.next_due_on <= ?`,
    facilityId,
    horizon,
  )
    .map((r) => ({
      assetId: r.asset_id,
      tag: r.tag,
      name: r.name,
      location: r.location,
      critical: r.critical === 1,
      scheduleId: r.schedule_id,
      scheduleName: r.schedule_name,
      kind: r.kind,
      regulator: r.regulator,
      blocksUse: r.blocks_use === 1,
      nextDueOn: r.next_due_on,
      daysLeft: Math.round(
        (Date.parse(`${r.next_due_on}T00:00:00.000Z`) - Date.parse(`${asOf}T00:00:00.000Z`)) / 86_400_000,
      ),
      overdue: r.next_due_on < asOf,
    }))
    .sort(
      (a, b) =>
        Number(b.blocksUse && b.overdue) - Number(a.blocksUse && a.overdue) || a.daysLeft - b.daysLeft,
    );
}

/**
 * ⚠️ Demonstration assets and schedules. The intervals are conventions rather
 * than regulation, and which assets are critical is a facility decision.
 */
export function seedAssets(facilityId: number, deviceCode: string): void {
  const BY = { byUserId: null, byUserName: "seed", deviceCode };
  // Relative to today rather than hard-coded, so a demonstration given next
  // year does not open on an estate that has been neglected since 2026.
  const since = (days: number) => addDays(today(), -days);
  const fridge = addAsset({
    facilityId, tag: "CC-01", name: "Vaccine refrigerator", category: "cold_chain",
    location: "Immunisation room", storeCode: "VACC",
    manufacturer: "Haier", model: "HBC-80", critical: true,
    acquiredOn: since(30 * 42), costCents: 38_000_00, usefulLifeMonths: 84, ...BY,
  });
  scheduleMaintenance({
    assetId: fridge, kind: "service", name: "Six-monthly service", everyDays: 182,
    lastDoneOn: since(120), deviceCode,
  });

  const autoclave = addAsset({
    facilityId, tag: "OT-AC-01", name: "Autoclave", category: "equipment",
    location: "Theatre sterilising room", manufacturer: "Tuttnauer", model: "3870EA",
    critical: true, acquiredOn: since(30 * 51), costCents: 95_000_00, usefulLifeMonths: 120, ...BY,
  });
  scheduleMaintenance({
    assetId: autoclave, kind: "safety_test", name: "Pressure vessel test", everyDays: 365,
    regulator: "DOSHS", blocksUse: true, lastDoneOn: since(200), deviceCode,
  });

  const xray = addAsset({
    facilityId, tag: "RAD-01", name: "Mobile X-ray unit", category: "equipment",
    location: "Casualty", manufacturer: "Shimadzu", model: "MobileDaRt",
    critical: true, acquiredOn: since(30 * 32), costCents: 480_000_00, usefulLifeMonths: 120,
    // Three years from delivery, so a repair billed today is one the supplier
    // owed — which is the point of recording the warranty at all.
    warrantyUntil: addDays(today(), 30 * 4), supplierCode: "SURGIPHARM",
    serviceContract: "Shimadzu East Africa — annual, includes QA survey", ...BY,
  });
  scheduleMaintenance({
    assetId: xray, kind: "licence", name: "Radiation facility licence", everyDays: 365,
    regulator: "KNRA", blocksUse: true, lastDoneOn: since(150), deviceCode,
  });
  scheduleMaintenance({
    assetId: xray, kind: "calibration", name: "Output and QA survey", everyDays: 182,
    regulator: "KNRA", blocksUse: true, lastDoneOn: since(120), deviceCode,
  });

  const generator = addAsset({
    facilityId, tag: "GEN-01", name: "Standby generator", category: "equipment",
    location: "Yard", manufacturer: "Perkins", model: "P22",
    critical: true, acquiredOn: since(30 * 58), costCents: 620_000_00, usefulLifeMonths: 120, ...BY,
  });
  scheduleMaintenance({
    assetId: generator, kind: "service", name: "Oil and filter change", everyDays: 90,
    lastDoneOn: since(75), deviceCode,
  });

  // What each room and modality cannot work without. This is the wiring that
  // turns `usable()` from an answer into a control: without it an autoclave
  // past its pressure test is a red line on the estates screen and the theatre
  // list goes on as before.
  dependsOn({ kind: "theatre", ref: "OT1", assetId: autoclave, why: "sterile instruments" });
  dependsOn({ kind: "theatre", ref: "OT2", assetId: autoclave, why: "sterile instruments" });
  dependsOn({ kind: "modality", ref: "xray", assetId: xray, why: "the only unit" });

  addAsset({
    facilityId, tag: "AMB-01", name: "Ambulance", category: "vehicle",
    location: "Yard", manufacturer: "Toyota", model: "Hiace",
    critical: true, acquiredOn: since(30 * 37), costCents: 4_500_000_00, usefulLifeMonths: 96, ...BY,
  });
}

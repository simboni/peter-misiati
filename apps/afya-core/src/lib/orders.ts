/**
 * M22 Orders (CPOE) — the diagnostic loop, and the state that closes it.
 *
 * Four states matter and the last one is the reason this module exists:
 *
 *   ordered → collected → resulted → ACKNOWLEDGED
 *
 * A result nobody read is the failure mode that kills people. It is also
 * completely invisible unless acknowledgement is a recorded state rather than
 * an assumption, which is why `unacknowledged()` is on the dashboard and why a
 * panic value raises a notification instead of waiting to be noticed.
 *
 * Ordering is licence-gated and raises the charge in the same breath, so the
 * investigation a clinician asked for is the investigation that appears on the
 * bill and on the claim. There is no separate step where somebody re-keys it.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { recordOp } from "./sync.ts";
import { check, explain, licenceStatus } from "./access.ts";
import { getEncounter } from "./encounters.ts";
import { getService, addCharge } from "./billing.ts";
import { notify } from "./notifications.ts";

export class OrderError extends Error {}

export type OrderKind = "lab" | "imaging" | "procedure";
export type OrderPriority = "routine" | "urgent" | "stat";
export type OrderStatus = "ordered" | "collected" | "in_progress" | "resulted" | "acknowledged" | "cancelled";

export interface Order {
  id: string;
  encounter_id: string;
  patient_mrn: string;
  kind: OrderKind;
  service_code: string;
  service_name: string;
  priority: OrderPriority;
  clinical_question: string;
  ordered_by: number | null;
  orderer_name: string;
  orderer_licence: string | null;
  status: OrderStatus;
  cancelled_reason: string | null;
  device_code: string | null;
  created_at: string;
  updated_at: string;
  resulted_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: number | null;
}

/**
 * Place an order.
 *
 * The charge is raised here, not later by someone reading a paper request. That
 * is the whole point: an investigation that was done and not billed is revenue
 * the facility never sees, and an investigation billed but not ordered is a
 * claim that gets rejected.
 */
export function placeOrder(input: {
  encounterId: string;
  kind: OrderKind;
  serviceCode: string;
  priority?: OrderPriority;
  clinicalQuestion?: string;
  payerCode: string;
  ordererId: number;
  ordererName: string;
  deviceCode: string;
}): string {
  const encounter = getEncounter(input.encounterId);
  if (!encounter) throw new OrderError("no such encounter");
  if (encounter.status !== "open") {
    throw new OrderError("this encounter is closed — an order on it would not be attributable to a consultation");
  }

  const decision = check(input.ordererId, "order.place");
  if (!decision.allowed) throw new OrderError(explain(decision));

  const service = getService(input.serviceCode);
  if (!service) throw new OrderError(`${input.serviceCode} is not a service on this system`);
  if (!service.active) throw new OrderError(`${service.name} has been withdrawn and cannot be ordered`);

  const id = mintLocalId(input.deviceCode, 8);
  const licence = licenceStatus(input.ordererId);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO orders
         (id, encounter_id, patient_mrn, kind, service_code, service_name, priority, clinical_question,
          ordered_by, orderer_name, orderer_licence, status, device_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ordered', ?, ?, ?)`,
      id,
      input.encounterId,
      encounter.patient_mrn,
      input.kind,
      service.code,
      service.name,
      input.priority ?? "routine",
      input.clinicalQuestion?.trim() ?? "",
      input.ordererId,
      input.ordererName,
      licence.state === "current" ? (licence.number ?? null) : null,
      input.deviceCode,
      at,
      at,
    );

    addCharge({
      encounterId: input.encounterId,
      serviceCode: service.code,
      payerCode: input.payerCode,
      sourceKind: input.kind === "lab" ? "lab" : input.kind === "imaging" ? "imaging" : "procedure",
      sourceRef: id,
      deviceCode: input.deviceCode,
      byUserId: input.ordererId,
      byUserName: input.ordererName,
    });

    recordOp({
      deviceCode: input.deviceCode,
      entity: "order",
      entityId: id,
      dataClass: "clinical",
      payload: { service: service.code, status: "ordered" },
      actorId: input.ordererId,
      actorName: input.ordererName,
    });

    audit({
      action: "order_placed",
      entity: "order",
      entityId: id,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.ordererId,
      actorName: input.ordererName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { service: service.code, kind: input.kind, priority: input.priority ?? "routine" },
    });

    // A stat order is somebody's next five minutes, not something to find on a
    // list later.
    if (input.priority === "stat") {
      notify({
        facilityId: encounter.facility_id,
        ownerRole: input.kind === "lab" ? "lab_technologist" : "nurse",
        severity: "critical",
        kind: "stat_order",
        subject: `STAT ${service.name} for ${encounter.patient_mrn}`,
        body: input.clinicalQuestion?.trim() || "Ordered stat.",
        entity: "order",
        entityId: id,
        dedupeKey: `stat:${id}`,
      });
    }

    return id;
  });
}

export function getOrder(id: string): Order | undefined {
  return get<Order>(`SELECT * FROM orders WHERE id = ?`, id);
}

export function ordersFor(encounterId: string): Order[] {
  return all<Order>(`SELECT * FROM orders WHERE encounter_id = ? ORDER BY created_at`, encounterId);
}

export function ordersForPatient(patientMrn: string): Order[] {
  return all<Order>(`SELECT * FROM orders WHERE patient_mrn = ? ORDER BY created_at DESC`, patientMrn);
}

/**
 * Advance an order's state.
 *
 * Only forwards, and only along the sequence. An order that jumps from ordered
 * to resulted without a specimen is a laboratory that cannot tell you what it
 * measured.
 */
export function setOrderStatus(input: {
  orderId: string;
  status: Exclude<OrderStatus, "cancelled" | "acknowledged">;
  byUserId: number | null;
  byUserName: string;
}): void {
  const order = getOrder(input.orderId);
  if (!order) throw new OrderError("no such order");
  if (order.status === "cancelled") throw new OrderError("that order was cancelled");

  const sequence: OrderStatus[] = ["ordered", "collected", "in_progress", "resulted", "acknowledged"];
  if (sequence.indexOf(input.status) < sequence.indexOf(order.status)) {
    throw new OrderError(`an order cannot go back from ${order.status} to ${input.status}`);
  }

  const at = now();
  run(
    `UPDATE orders SET status = ?, updated_at = ?, resulted_at = CASE WHEN ? = 'resulted' THEN ? ELSE resulted_at END
      WHERE id = ?`,
    input.status,
    at,
    input.status,
    at,
    input.orderId,
  );
}

export function cancelOrder(input: {
  orderId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const order = getOrder(input.orderId);
  if (!order) throw new OrderError("no such order");
  if (!input.reason.trim()) throw new OrderError("cancelling an order must record why");
  if (order.status === "resulted" || order.status === "acknowledged") {
    throw new OrderError("that order has already been reported — it cannot be cancelled, only superseded");
  }

  tx(() => {
    run(
      `UPDATE orders SET status = 'cancelled', cancelled_reason = ?, updated_at = ? WHERE id = ?`,
      input.reason.trim(),
      now(),
      input.orderId,
    );
    audit({
      action: "order_cancelled",
      entity: "order",
      entityId: input.orderId,
      patientId: order.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { service: order.service_code, reason: input.reason },
    });
  });
}

/**
 * A clinician says they have seen the result.
 *
 * The state the whole module exists for. Until this happens the result is
 * outstanding, however long ago the laboratory released it.
 */
export function acknowledgeResult(input: {
  orderId: string;
  byUserId: number;
  byUserName: string;
  /** What is being done about it. Optional for a normal result. */
  action?: string;
}): void {
  const order = getOrder(input.orderId);
  if (!order) throw new OrderError("no such order");
  if (order.status !== "resulted") {
    throw new OrderError(
      order.status === "acknowledged"
        ? "that result has already been acknowledged"
        : "there is no result to acknowledge yet",
    );
  }

  const at = now();
  tx(() => {
    run(
      `UPDATE orders SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, updated_at = ? WHERE id = ?`,
      at,
      input.byUserId,
      at,
      input.orderId,
    );
    audit({
      action: "result_acknowledged",
      entity: "order",
      entityId: input.orderId,
      patientId: order.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { service: order.service_code, action: input.action ?? null },
    });
  });
}

// ------------------------------------------------------------------ worklists

/** What the laboratory or the imaging room has waiting, most urgent first. */
export function pendingOrders(kind?: OrderKind): (Order & { patient_name: string })[] {
  const rows = kind
    ? all<Order & { patient_name: string }>(
        `SELECT o.*, p.given_name || ' ' || p.family_name AS patient_name
           FROM orders o JOIN patients p ON p.mrn = o.patient_mrn
          WHERE o.kind = ? AND o.status IN ('ordered','collected','in_progress')`,
        kind,
      )
    : all<Order & { patient_name: string }>(
        `SELECT o.*, p.given_name || ' ' || p.family_name AS patient_name
           FROM orders o JOIN patients p ON p.mrn = o.patient_mrn
          WHERE o.status IN ('ordered','collected','in_progress')`,
      );

  const rank = { stat: 0, urgent: 1, routine: 2 } as const;
  return rows.sort((a, b) => rank[a.priority] - rank[b.priority] || a.created_at.localeCompare(b.created_at));
}

export interface UnacknowledgedResult {
  order: Order;
  patientName: string;
  hoursWaiting: number;
  /** True when at least one released value is outside the reference range. */
  abnormal: boolean;
  panic: boolean;
}

/**
 * Results that have been reported and not read.
 *
 * Deliberately ranked by whether the result was abnormal and then by how long
 * it has waited, because a normal result nobody read is untidy and an abnormal
 * one nobody read is a harm event waiting to be written up.
 */
export function unacknowledged(): UnacknowledgedResult[] {
  const rows = all<Order & { patient_name: string; abnormal: number; panic: number }>(
    `SELECT o.*, p.given_name || ' ' || p.family_name AS patient_name,
            EXISTS (SELECT 1 FROM lab_results r WHERE r.order_id = o.id AND r.superseded_at IS NULL
                      AND r.released_at IS NOT NULL AND r.flag <> 'normal') AS abnormal,
            EXISTS (SELECT 1 FROM lab_results r WHERE r.order_id = o.id AND r.superseded_at IS NULL
                      AND r.released_at IS NOT NULL AND r.flag IN ('panic_low','panic_high')) AS panic
       FROM orders o JOIN patients p ON p.mrn = o.patient_mrn
      WHERE o.status = 'resulted'`,
  );

  const nowMs = Date.now();
  return rows
    .map((r) => ({
      order: r,
      patientName: r.patient_name,
      hoursWaiting: Math.floor((nowMs - Date.parse(r.resulted_at ?? r.updated_at)) / 3_600_000),
      abnormal: r.abnormal === 1,
      panic: r.panic === 1,
    }))
    .sort(
      (a, b) =>
        Number(b.panic) - Number(a.panic) ||
        Number(b.abnormal) - Number(a.abnormal) ||
        b.hoursWaiting - a.hoursWaiting,
    );
}

/** Median hours from order to result, per service — the number a lab is judged on. */
export function turnaround(kind: OrderKind = "lab"): { serviceCode: string; serviceName: string; n: number; medianHours: number }[] {
  const rows = all<{ service_code: string; service_name: string; created_at: string; resulted_at: string }>(
    `SELECT service_code, service_name, created_at, resulted_at FROM orders
      WHERE kind = ? AND resulted_at IS NOT NULL`,
    kind,
  );

  const byService = new Map<string, { name: string; hours: number[] }>();
  for (const r of rows) {
    const hours = (Date.parse(r.resulted_at) - Date.parse(r.created_at)) / 3_600_000;
    const entry = byService.get(r.service_code) ?? { name: r.service_name, hours: [] };
    entry.hours.push(hours);
    byService.set(r.service_code, entry);
  }

  return [...byService.entries()]
    .map(([code, { name, hours }]) => {
      const sorted = [...hours].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return {
        serviceCode: code,
        serviceName: name,
        n: sorted.length,
        medianHours:
          Math.round((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10,
      };
    })
    .sort((a, b) => b.medianHours - a.medianHours);
}

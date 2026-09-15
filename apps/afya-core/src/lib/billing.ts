/**
 * M50 Billing and M52 eTIMS.
 *
 * MONEY IS INTEGER CENTS OF KES. Never a float, `_cents` suffix always. A
 * rounding drift of one cent per line becomes a rejected claim and an
 * unreconcilable ledger.
 *
 * Two rules carry this module.
 *
 *  1. A CHARGE ALWAYS POINTS AT THE CLINICAL EVENT THAT PRODUCED IT.
 *     Weakness W7 is revenue leakage: drugs dispensed but never billed, because
 *     money and medicine live in separate ledgers. `source_kind`/`source_ref`
 *     make a bill defensible line by line, and make the gap visible — see
 *     `leakageReport`, which lists clinical events with no charge against them.
 *
 *  2. EVERY ENCOUNTER ENDS IN AN eTIMS-COMPLIANT INVOICE.
 *     Hospitals must onboard to eTIMS even though medical services are
 *     VAT-exempt, and every consultation, drug and test must be invoiced —
 *     cash, insurance or corporate alike. The invoice is issued locally with a
 *     provisional number and queued; KRA assigns the canonical number on
 *     transmission and BOTH are kept. The number on the patient's paper slip
 *     must never stop resolving.
 *
 * Tariffs are dated. A price that changed last month must not silently reprice
 * care given before it.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now, today } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { call } from "./integration.ts";
import { recordOp } from "./sync.ts";
import { getEncounter, activeDiagnoses } from "./encounters.ts";
import { prescriptionsFor } from "./prescribing.ts";
import { getPayer, benefitFor } from "./payers.ts";

export class BillingError extends Error {}

export interface Service {
  code: string;
  name: string;
  category: string;
  etims_class: string;
  active: number;
}

export interface Charge {
  id: string;
  encounter_id: string;
  patient_mrn: string;
  service_code: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
  payer_code: string;
  source_kind: "consultation" | "prescription" | "procedure" | "lab" | "imaging" | "other";
  source_ref: string | null;
  tariff_source: string;
  created_by: number | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export interface Invoice {
  id: string;
  encounter_id: string;
  patient_mrn: string;
  payer_code: string;
  total_cents: number;
  status: "issued" | "paid" | "void";
  issued_at: string;
  etims_number: string | null;
  etims_status: "queued" | "sent" | "failed" | "not_required";
  created_at: string;
}

/** Format cents as KES for display. Never used for arithmetic. */
export function formatKes(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}KES ${Math.floor(abs / 100).toLocaleString("en-KE")}.${String(abs % 100).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ services

export function defineService(input: {
  code: string;
  name: string;
  category?: string;
  etimsClass?: string;
}): void {
  run(
    `INSERT INTO services (code, name, category, etims_class) VALUES (?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, category = excluded.category, etims_class = excluded.etims_class`,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    input.category ?? "general",
    input.etimsClass ?? "",
  );
}

export function listServices(): Service[] {
  return all<Service>(`SELECT * FROM services WHERE active = 1 ORDER BY category, name`);
}

export function getService(code: string): Service | undefined {
  return get<Service>(`SELECT * FROM services WHERE code = ?`, code.trim().toUpperCase());
}

// ------------------------------------------------------------------- tariffs

export function setTariff(input: {
  payerCode: string;
  serviceCode: string;
  priceCents: number;
  effectiveFrom?: string;
  source: string;
}): void {
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    throw new BillingError("a price must be a whole number of cents, not negative");
  }
  if (!input.source.trim()) {
    throw new BillingError("a tariff must record its source, e.g. 'SHA tariff 2026/28'");
  }
  run(
    `INSERT INTO tariffs (payer_code, service_code, price_cents, effective_from, source)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(payer_code, service_code, effective_from) DO UPDATE SET
       price_cents = excluded.price_cents, source = excluded.source`,
    input.payerCode.trim().toUpperCase(),
    input.serviceCode.trim().toUpperCase(),
    input.priceCents,
    input.effectiveFrom ?? today(),
    input.source.trim(),
  );
}

/**
 * The price in force for a payer on a given date.
 *
 * `asOf` is the date of service, not today: a tariff revised since must not
 * reprice care already given.
 */
export function priceFor(
  payerCode: string,
  serviceCode: string,
  asOf = today(),
): { price_cents: number; source: string } | null {
  return (
    get<{ price_cents: number; source: string }>(
      `SELECT price_cents, source FROM tariffs
        WHERE payer_code = ? AND service_code = ? AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC LIMIT 1`,
      payerCode.trim().toUpperCase(),
      serviceCode.trim().toUpperCase(),
      asOf,
      asOf,
    ) ?? null
  );
}

// ------------------------------------------------------------------- charges

export function addCharge(input: {
  encounterId: string;
  serviceCode: string;
  quantity?: number;
  payerCode: string;
  sourceKind: Charge["source_kind"];
  sourceRef?: string | null;
  description?: string;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): string {
  const encounter = getEncounter(input.encounterId);
  if (!encounter) throw new BillingError("no such encounter");

  const service = getService(input.serviceCode);
  if (!service) throw new BillingError(`${input.serviceCode} is not a billable service on this system`);

  const payer = getPayer(input.payerCode);
  if (!payer) throw new BillingError(`unknown payer ${input.payerCode}`);

  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new BillingError("quantity must be a whole number greater than zero");
  }

  // Priced as of the date of service.
  const serviceDate = encounter.opened_at.slice(0, 10);
  const tariff = priceFor(payer.code, service.code, serviceDate);
  if (!tariff) {
    throw new BillingError(
      `no ${payer.name} tariff for ${service.name} on ${serviceDate}. Load the tariff before billing it — an unpriced line is a rejected claim line.`,
    );
  }

  const id = mintLocalId(input.deviceCode, 8);
  const amount = tariff.price_cents * quantity;

  return tx(() => {
    run(
      `INSERT INTO charges
         (id, encounter_id, patient_mrn, service_code, description, quantity,
          unit_price_cents, amount_cents, payer_code, source_kind, source_ref,
          tariff_source, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.encounterId,
      encounter.patient_mrn,
      service.code,
      input.description?.trim() || service.name,
      quantity,
      tariff.price_cents,
      amount,
      payer.code,
      input.sourceKind,
      input.sourceRef ?? null,
      tariff.source,
      input.byUserId,
      now(),
    );

    recordOp({
      deviceCode: input.deviceCode,
      entity: "charge",
      entityId: id,
      // Money is server-authoritative on conflict, and a variance is logged
      // rather than dropped.
      dataClass: "ledger",
      payload: { encounter_id: input.encounterId, service_code: service.code, amount_cents: amount },
      actorId: input.byUserId,
      actorName: input.byUserName,
    });

    audit({
      action: "charge_added",
      entity: "charge",
      entityId: id,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "billing",
      deviceCode: input.deviceCode,
      detail: {
        service: service.code,
        quantity,
        amountCents: amount,
        payer: payer.code,
        source: `${input.sourceKind}:${input.sourceRef ?? ""}`,
      },
    });

    return id;
  });
}

export function voidCharge(input: {
  chargeId: string;
  reason: string;
  byUserId: number;
  byUserName: string;
}): void {
  const charge = get<Charge>(`SELECT * FROM charges WHERE id = ?`, input.chargeId);
  if (!charge) throw new BillingError("no such charge");
  if (charge.voided_at) throw new BillingError("that charge is already voided");
  if (!input.reason.trim()) throw new BillingError("voiding a charge must record why");

  tx(() => {
    run(
      `UPDATE charges SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?`,
      now(),
      input.byUserId,
      input.reason.trim(),
      input.chargeId,
    );
    audit({
      action: "charge_voided",
      entity: "charge",
      entityId: input.chargeId,
      patientId: charge.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "billing",
      detail: { amountCents: charge.amount_cents, reason: input.reason },
    });
  });
}

export function chargesFor(encounterId: string): Charge[] {
  return all<Charge>(
    `SELECT * FROM charges WHERE encounter_id = ? AND voided_at IS NULL ORDER BY created_at`,
    encounterId,
  );
}

export function encounterTotalCents(encounterId: string): number {
  return chargesFor(encounterId).reduce((sum, c) => sum + c.amount_cents, 0);
}

/**
 * Assemble the charges an encounter implies, without duplicating what is there.
 *
 * This is the "one event, one charge" spine applied to what exists so far: the
 * consultation itself, and every active prescription. Dispensing and lab work
 * join it when those modules land — each one adds a `sourceKind`, nothing else
 * changes.
 */
export function assembleCharges(input: {
  encounterId: string;
  payerCode: string;
  consultationService?: string;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): { added: string[]; skipped: string[] } {
  const encounter = getEncounter(input.encounterId);
  if (!encounter) throw new BillingError("no such encounter");

  const existing = chargesFor(input.encounterId);
  const already = new Set(existing.map((c) => `${c.source_kind}:${c.source_ref ?? ""}`));
  const added: string[] = [];
  const skipped: string[] = [];

  const consultationCode = input.consultationService ?? "CONSULT-OP";
  if (!already.has(`consultation:${input.encounterId}`)) {
    added.push(
      addCharge({
        encounterId: input.encounterId,
        serviceCode: consultationCode,
        payerCode: input.payerCode,
        sourceKind: "consultation",
        sourceRef: input.encounterId,
        deviceCode: input.deviceCode,
        byUserId: input.byUserId,
        byUserName: input.byUserName,
      }),
    );
  } else {
    skipped.push(consultationCode);
  }

  for (const rx of prescriptionsFor(input.encounterId)) {
    if (rx.status === "cancelled") continue;
    if (already.has(`prescription:${rx.id}`)) {
      skipped.push(rx.product_code);
      continue;
    }
    // A product is billed under its own code; a facility that has not priced it
    // is told so rather than quietly dropping the line.
    if (!getService(rx.product_code)) {
      skipped.push(rx.product_code);
      continue;
    }
    added.push(
      addCharge({
        encounterId: input.encounterId,
        serviceCode: rx.product_code,
        quantity: rx.quantity,
        payerCode: input.payerCode,
        sourceKind: "prescription",
        sourceRef: rx.id,
        description: rx.product_name,
        deviceCode: input.deviceCode,
        byUserId: input.byUserId,
        byUserName: input.byUserName,
      }),
    );
  }

  return { added, skipped };
}

/**
 * Clinical events with no charge against them.
 *
 * The direct answer to weakness W7. A facility can see, per encounter, what it
 * did and did not bill for — the number an owner has never been able to get.
 */
export function leakageReport(encounterId: string): { kind: string; ref: string; description: string }[] {
  const billed = new Set(chargesFor(encounterId).map((c) => `${c.source_kind}:${c.source_ref ?? ""}`));
  const gaps: { kind: string; ref: string; description: string }[] = [];

  if (!billed.has(`consultation:${encounterId}`)) {
    gaps.push({ kind: "consultation", ref: encounterId, description: "The consultation itself is not billed" });
  }
  for (const rx of prescriptionsFor(encounterId)) {
    if (rx.status === "cancelled") continue;
    if (!billed.has(`prescription:${rx.id}`)) {
      gaps.push({ kind: "prescription", ref: rx.id, description: `${rx.product_name} prescribed but not billed` });
    }
  }
  return gaps;
}

/**
 * Revenue leakage across the facility.
 *
 * Work that was done and never made it onto an invoice: a consultation with no
 * charge, a drug dispensed and not billed, a closed encounter with nothing
 * raised at all. This is the number a facility owner reacts to, because it is
 * money they have already spent the staff time and the stock to earn.
 *
 * Counted against CLOSED encounters only. An open consultation is not leakage,
 * it is a consultation in progress.
 */
export function facilityLeakage(facilityId: number, sinceDays = 90): {
  totalCents: number;
  encounters: number;
  gaps: { encounterId: string; patientMrn: string; kind: string; description: string; estimateCents: number }[];
} {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const encounters = all<{ id: string; patient_mrn: string; payer: string | null }>(
    `SELECT e.id, e.patient_mrn,
            (SELECT i.payer_code FROM invoices i WHERE i.encounter_id = e.id AND i.status <> 'void') AS payer
       FROM encounters e
      WHERE e.facility_id = ? AND e.status = 'closed' AND e.closed_at >= ?`,
    facilityId,
    since,
  );

  const gaps: { encounterId: string; patientMrn: string; kind: string; description: string; estimateCents: number }[] = [];
  const touched = new Set<string>();

  for (const encounter of encounters) {
    // Priced against the payer the encounter was actually invoiced to, falling
    // back to cash — an estimate that is honest about being one.
    const payer = encounter.payer ?? "CASH";
    for (const gap of leakageReport(encounter.id)) {
      const serviceCode = gap.kind === "consultation" ? "CONSULT-OP" : null;
      const price = serviceCode ? priceFor(payer, serviceCode)?.price_cents ?? 0 : 0;
      gaps.push({
        encounterId: encounter.id,
        patientMrn: encounter.patient_mrn,
        kind: gap.kind,
        description: gap.description,
        estimateCents: price,
      });
      touched.add(encounter.id);
    }
  }

  return {
    totalCents: gaps.reduce((sum, g) => sum + g.estimateCents, 0),
    encounters: touched.size,
    gaps: gaps.sort((a, b) => b.estimateCents - a.estimateCents).slice(0, 25),
  };
}

// ------------------------------------------------------------------ invoices

/**
 * Issue the invoice for an encounter.
 *
 * Minted locally with a device-prefixed provisional number and queued for
 * eTIMS. It is issued whether the payer is SHA, an insurer or cash — every
 * encounter ends in a KRA-compliant invoice.
 */
export function issueInvoice(input: {
  encounterId: string;
  payerCode: string;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): string {
  const encounter = getEncounter(input.encounterId);
  if (!encounter) throw new BillingError("no such encounter");

  const existing = get<Invoice>(
    `SELECT * FROM invoices WHERE encounter_id = ? AND status <> 'void'`,
    input.encounterId,
  );
  if (existing) throw new BillingError(`this encounter already has invoice ${existing.id}`);

  const charges = chargesFor(input.encounterId);
  if (charges.length === 0) {
    throw new BillingError("there is nothing to invoice — assemble the charges first");
  }

  const total = charges.reduce((sum, c) => sum + c.amount_cents, 0);
  const id = mintLocalId(input.deviceCode, 8);
  const at = now();

  return tx(() => {
    run(
      `INSERT INTO invoices
         (id, encounter_id, patient_mrn, payer_code, total_cents, status, issued_at, issued_by, etims_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'issued', ?, ?, 'queued', ?)`,
      id,
      input.encounterId,
      encounter.patient_mrn,
      input.payerCode.trim().toUpperCase(),
      total,
      at,
      input.byUserId,
      at,
    );

    // Queued, not sent. Transmission happens when a link exists.
    run(
      `INSERT INTO etims_queue (invoice_id, kind, payload, status, queued_at)
       VALUES (?, 'invoice', ?, 'queued', ?)`,
      id,
      JSON.stringify({
        provisionalNumber: id,
        patient: encounter.patient_mrn,
        totalCents: total,
        lines: charges.map((c) => ({
          service: c.service_code,
          description: c.description,
          quantity: c.quantity,
          unitPriceCents: c.unit_price_cents,
          amountCents: c.amount_cents,
          etimsClass: getService(c.service_code)?.etims_class ?? "",
        })),
      }),
      at,
    );

    recordOp({
      deviceCode: input.deviceCode,
      entity: "invoice",
      entityId: id,
      dataClass: "ledger",
      payload: { encounter_id: input.encounterId, total_cents: total },
      actorId: input.byUserId,
      actorName: input.byUserName,
    });

    audit({
      action: "invoice_issued",
      entity: "invoice",
      entityId: id,
      patientId: encounter.patient_mrn,
      facilityId: encounter.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "billing",
      deviceCode: input.deviceCode,
      detail: { totalCents: total, lines: charges.length, payer: input.payerCode },
    });

    return id;
  });
}

export function getInvoice(id: string): Invoice | undefined {
  return get<Invoice>(`SELECT * FROM invoices WHERE id = ?`, id);
}

export function invoiceForEncounter(encounterId: string): Invoice | undefined {
  return get<Invoice>(`SELECT * FROM invoices WHERE encounter_id = ? AND status <> 'void'`, encounterId);
}

// ------------------------------------------------------------------ payments

export function recordPayment(input: {
  invoiceId: string;
  method: "cash" | "mpesa" | "card" | "cheque" | "insurance" | "waiver";
  amountCents: number;
  reference?: string;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): string {
  const invoice = getInvoice(input.invoiceId);
  if (!invoice) throw new BillingError("no such invoice");
  if (invoice.status === "void") throw new BillingError("that invoice has been voided");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new BillingError("a payment must be a whole number of cents greater than zero");
  }

  const paid = paidCents(input.invoiceId);
  if (paid + input.amountCents > invoice.total_cents) {
    throw new BillingError(
      `that would overpay the invoice: ${formatKes(paid)} already received against ${formatKes(invoice.total_cents)}`,
    );
  }

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO payments (id, invoice_id, method, amount_cents, reference, received_by, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.invoiceId,
      input.method,
      input.amountCents,
      input.reference?.trim() ?? "",
      input.byUserId,
      now(),
    );

    if (paid + input.amountCents === invoice.total_cents) {
      run(`UPDATE invoices SET status = 'paid' WHERE id = ?`, input.invoiceId);
    }

    recordOp({
      deviceCode: input.deviceCode,
      entity: "payment",
      entityId: id,
      dataClass: "ledger",
      payload: { invoice_id: input.invoiceId, amount_cents: input.amountCents, method: input.method },
      actorId: input.byUserId,
      actorName: input.byUserName,
    });

    audit({
      action: "payment_received",
      entity: "payment",
      entityId: id,
      patientId: invoice.patient_mrn,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "billing",
      deviceCode: input.deviceCode,
      detail: { invoice: input.invoiceId, method: input.method, amountCents: input.amountCents },
    });

    return id;
  });
}

export function paidCents(invoiceId: string): number {
  return (
    get<{ total: number }>(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE invoice_id = ?`, invoiceId)
      ?.total ?? 0
  );
}

export function balanceCents(invoiceId: string): number {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new BillingError("no such invoice");
  return invoice.total_cents - paidCents(invoiceId);
}

// --------------------------------------------------------------------- eTIMS

export interface EtimsEntry {
  id: number;
  invoice_id: string;
  kind: "invoice" | "credit_note";
  payload: string;
  status: "queued" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
  canonical_number: string | null;
  queued_at: string;
  sent_at: string | null;
}

/**
 * The eTIMS transmitter, injected so a real KRA adapter drops in unchanged.
 * Returns the canonical invoice number KRA assigns.
 */
export type EtimsTransmitter = (payload: string) =>
  | { ok: true; canonicalNumber: string }
  | { ok: false; error: string };

/** For a facility with no tax link at all: everything stays queued and visible. */
export const ETIMS_NOT_CONFIGURED: EtimsTransmitter = () => ({
  ok: false,
  error: "no eTIMS adapter is configured on this installation",
});

/**
 * The default: transmit through the integration hub.
 *
 * The hub applies the retry policy and dead-letters what never gets through, so
 * this only has to decide what to do with the answer. A queued invoice that
 * fails here stays queued with the reason on it — an untransmitted tax invoice
 * is a compliance failure the facility must be able to see.
 */
export const ETIMS_VIA_HUB: EtimsTransmitter = (payload) => {
  const invoice = JSON.parse(payload) as {
    provisionalNumber?: string;
    totalCents?: number;
    lines?: unknown[];
  };
  const result = call({
    endpoint: "ETIMS",
    operation: "transmitInvoice",
    request: {
      provisionalNumber: invoice.provisionalNumber ?? "",
      totalCents: invoice.totalCents ?? 0,
      lines: invoice.lines ?? [],
    },
  });

  if (!result.ok) return { ok: false, error: result.error };
  const canonical = result.data.canonicalNumber;
  if (typeof canonical !== "string" || !canonical) {
    return { ok: false, error: "the tax authority acknowledged without assigning an invoice number" };
  }
  return { ok: true, canonicalNumber: canonical };
};

/**
 * Transmit whatever is queued.
 *
 * Run when a link exists. A failure is left queued with the error recorded and
 * an attempt counted — never dropped, because an untransmitted invoice is a tax
 * compliance failure the facility will not discover on its own.
 */
export function flushEtims(transmit: EtimsTransmitter = ETIMS_VIA_HUB): {
  sent: number;
  failed: number;
} {
  const queued = all<EtimsEntry>(`SELECT * FROM etims_queue WHERE status = 'queued' ORDER BY queued_at`);
  let sent = 0;
  let failed = 0;

  for (const entry of queued) {
    const result = transmit(entry.payload);
    if (result.ok) {
      tx(() => {
        run(
          `UPDATE etims_queue SET status = 'sent', canonical_number = ?, sent_at = ?, attempts = attempts + 1 WHERE id = ?`,
          result.canonicalNumber,
          now(),
          entry.id,
        );
        // Both numbers are kept: the provisional one is on the patient's slip.
        run(
          `UPDATE invoices SET etims_number = ?, etims_status = 'sent' WHERE id = ?`,
          result.canonicalNumber,
          entry.invoice_id,
        );
        audit({
          action: "etims_transmitted",
          entity: "invoice",
          entityId: entry.invoice_id,
          actorName: "system",
          purpose: "billing",
          detail: { provisionalNumber: entry.invoice_id, canonicalNumber: result.canonicalNumber },
        });
      });
      sent++;
    } else {
      run(
        `UPDATE etims_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?`,
        result.error,
        entry.id,
      );
      failed++;
    }
  }

  return { sent, failed };
}

export interface EtimsBacklog {
  queued: number;
  oldestQueuedAt: string | null;
  lastError: string | null;
}

/** What the compliance dashboard shows for tax transmission. */
export function etimsBacklog(): EtimsBacklog {
  const row = get<{ n: number; oldest: string | null; err: string | null }>(
    `SELECT COUNT(*) AS n, MIN(queued_at) AS oldest, MAX(last_error) AS err
       FROM etims_queue WHERE status = 'queued'`,
  )!;
  return { queued: row.n ?? 0, oldestQueuedAt: row.oldest, lastError: row.err };
}

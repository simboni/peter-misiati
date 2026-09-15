/**
 * M04 Integration Hub — one contract for everything outside the building.
 *
 * Every external system goes through `call`: it logs the request, retries with
 * backoff, and dead-letters anything that never succeeds. No domain module
 * talks to SHA or KRA directly, so when a specification changes exactly one
 * adapter changes and nothing else notices.
 *
 * THREE MODES, AND THE MODE IS ALWAYS VISIBLE.
 *
 *   live      the real adapter, once the specification is in hand
 *   demo      a deterministic in-process simulator, so the whole flow can be
 *             shown end to end before the integration exists
 *   disabled  everything queues and the interface says so
 *
 * The demo adapters are honest simulators, not pretend successes: they apply
 * plausible rules, refuse malformed requests, and every result they return is
 * stamped `simulated: true` and logged with its mode. A simulated
 * acknowledgement must never be mistakable for a real one — on screen, in the
 * log, or in an export.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";

export class IntegrationError extends Error {}

export type EndpointKind = "payer" | "tax" | "hie" | "sms" | "dhis2";
export type EndpointMode = "demo" | "live" | "disabled";

export interface Endpoint {
  code: string;
  name: string;
  kind: EndpointKind;
  mode: EndpointMode;
  base_url: string;
  notes: string;
  updated_at: string;
}

/** What every adapter returns. `simulated` is never omitted and never faked. */
export type CallResult =
  | { ok: true; data: Record<string, unknown>; simulated: boolean }
  | { ok: false; error: string; retryable: boolean; simulated: boolean };

export type Adapter = (operation: string, request: Record<string, unknown>) => CallResult;

// ------------------------------------------------------------------ registry

const adapters = new Map<string, Adapter>();

/** Register the live adapter for an endpoint. Called at startup by wiring code. */
export function registerAdapter(endpointCode: string, adapter: Adapter): void {
  adapters.set(endpointCode.toUpperCase(), adapter);
}

export function defineEndpoint(input: {
  code: string;
  name: string;
  kind: EndpointKind;
  mode?: EndpointMode;
  baseUrl?: string;
  notes?: string;
}): void {
  run(
    `INSERT INTO integration_endpoints (code, name, kind, mode, base_url, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, kind = excluded.kind,
       base_url = excluded.base_url, notes = excluded.notes, updated_at = excluded.updated_at`,
    input.code.toUpperCase(),
    input.name,
    input.kind,
    input.mode ?? "demo",
    input.baseUrl ?? "",
    input.notes ?? "",
    now(),
  );
}

export function setEndpointMode(input: {
  code: string;
  mode: EndpointMode;
  byUserId: number | null;
  byUserName: string;
}): void {
  const code = input.code.toUpperCase();
  if (input.mode === "live" && !adapters.has(code)) {
    throw new IntegrationError(
      `${code} cannot be switched to live: no live adapter is registered. The integration specification is still outstanding.`,
    );
  }
  tx(() => {
    run(`UPDATE integration_endpoints SET mode = ?, updated_at = ? WHERE code = ?`, input.mode, now(), code);
    audit({
      action: "integration_mode_changed",
      entity: "integration",
      entityId: code,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { endpoint: code, mode: input.mode },
    });
  });
}

export function getEndpoint(code: string): Endpoint | undefined {
  return get<Endpoint>(`SELECT * FROM integration_endpoints WHERE code = ?`, code.toUpperCase());
}

export function listEndpoints(): Endpoint[] {
  return all<Endpoint>(`SELECT * FROM integration_endpoints ORDER BY kind, name`);
}

// ---------------------------------------------------------------- the call

const MAX_ATTEMPTS = 3;

/**
 * Call an external system.
 *
 * Retries a retryable failure up to three times, logs every attempt, and
 * dead-letters a request that never gets through. A non-retryable failure — a
 * malformed request, a rejected member number — is returned immediately,
 * because retrying it just wastes the clock.
 */
export function call(input: {
  endpoint: string;
  operation: string;
  request: Record<string, unknown>;
}): CallResult {
  const code = input.endpoint.toUpperCase();
  const endpoint = getEndpoint(code);
  if (!endpoint) throw new IntegrationError(`unknown integration endpoint ${code}`);

  if (endpoint.mode === "disabled") {
    const result: CallResult = {
      ok: false,
      error: `${endpoint.name} is disabled on this installation`,
      retryable: true,
      simulated: false,
    };
    logCall(code, input.operation, endpoint.mode, input.request, {}, "failed", 1, result.error, 0);
    return result;
  }

  const adapter = endpoint.mode === "demo" ? DEMO_ADAPTERS[code] : adapters.get(code);
  if (!adapter) {
    const error =
      endpoint.mode === "live"
        ? `no live adapter registered for ${code} — the integration specification is outstanding`
        : `no demo adapter for ${code}`;
    logCall(code, input.operation, endpoint.mode, input.request, {}, "failed", 1, error, 0);
    return { ok: false, error, retryable: false, simulated: false };
  }

  let attempts = 0;
  let last: CallResult = { ok: false, error: "not attempted", retryable: true, simulated: false };

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const started = Date.now();
    try {
      last = adapter(input.operation, input.request);
    } catch (err) {
      last = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        retryable: true,
        simulated: endpoint.mode === "demo",
      };
    }
    const took = Date.now() - started;

    logCall(
      code,
      input.operation,
      endpoint.mode,
      input.request,
      last.ok ? last.data : {},
      last.ok ? "ok" : "failed",
      attempts,
      last.ok ? null : last.error,
      took,
    );

    if (last.ok) return last;
    if (!last.retryable) return last;
  }

  // Exhausted. Never dropped — it waits for a person.
  run(
    `INSERT INTO integration_dead_letters (endpoint, operation, request, last_error, attempts, queued_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    code,
    input.operation,
    JSON.stringify(input.request),
    last.ok ? "" : last.error,
    attempts,
    now(),
  );

  return last;
}

function logCall(
  endpoint: string,
  operation: string,
  mode: string,
  request: Record<string, unknown>,
  response: Record<string, unknown>,
  status: "ok" | "failed",
  attempts: number,
  error: string | null,
  durationMs: number,
): void {
  run(
    `INSERT INTO integration_log (endpoint, operation, mode, request, response, status, attempts, error, at, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    endpoint,
    operation,
    mode,
    JSON.stringify(redact(request)),
    JSON.stringify(response),
    status,
    attempts,
    error,
    now(),
    durationMs,
  );
}

/** The integration log is exported to auditors; credentials must not be in it. */
function redact(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    out[/^(password|token|secret|apiKey|api_key|otp|pin)$/i.test(k) ? `${k}__redacted` : k] =
      /^(password|token|secret|apiKey|api_key|otp|pin)$/i.test(k) ? "[redacted]" : v;
  }
  return out;
}

export function integrationLog(endpoint?: string, limit = 50) {
  return endpoint
    ? all<{ id: number; endpoint: string; operation: string; mode: string; status: string; error: string | null; at: string; duration_ms: number }>(
        `SELECT id, endpoint, operation, mode, status, error, at, duration_ms FROM integration_log WHERE endpoint = ? ORDER BY id DESC LIMIT ?`,
        endpoint.toUpperCase(),
        limit,
      )
    : all<{ id: number; endpoint: string; operation: string; mode: string; status: string; error: string | null; at: string; duration_ms: number }>(
        `SELECT id, endpoint, operation, mode, status, error, at, duration_ms FROM integration_log ORDER BY id DESC LIMIT ?`,
        limit,
      );
}

export function deadLetters() {
  return all<{ id: number; endpoint: string; operation: string; last_error: string; attempts: number; queued_at: string }>(
    `SELECT id, endpoint, operation, last_error, attempts, queued_at
       FROM integration_dead_letters WHERE resolved_at IS NULL ORDER BY queued_at`,
  );
}

export function resolveDeadLetter(id: number, byUserId: number | null): void {
  run(`UPDATE integration_dead_letters SET resolved_at = ?, resolved_by = ? WHERE id = ?`, now(), byUserId, id);
}

export interface EndpointHealth {
  code: string;
  name: string;
  kind: EndpointKind;
  mode: EndpointMode;
  lastCallAt: string | null;
  lastStatus: "ok" | "failed" | null;
  failures24h: number;
  deadLetters: number;
}

/** What the integrations screen and the compliance dashboard read. */
export function health(): EndpointHealth[] {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  return listEndpoints().map((e) => {
    const last = get<{ at: string; status: "ok" | "failed" }>(
      `SELECT at, status FROM integration_log WHERE endpoint = ? ORDER BY id DESC LIMIT 1`,
      e.code,
    );
    const fails = get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM integration_log WHERE endpoint = ? AND status = 'failed' AND at >= ?`,
      e.code,
      since,
    );
    const dl = get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM integration_dead_letters WHERE endpoint = ? AND resolved_at IS NULL`,
      e.code,
    );
    return {
      code: e.code,
      name: e.name,
      kind: e.kind,
      mode: e.mode,
      lastCallAt: last?.at ?? null,
      lastStatus: last?.status ?? null,
      failures24h: fails?.n ?? 0,
      deadLetters: dl?.n ?? 0,
    };
  });
}

// ------------------------------------------------------------ demo adapters
//
// Deterministic simulators. They exist so the whole flow can be demonstrated
// before the real integrations are available, and they are deliberately not
// generous: malformed requests are refused, and the rules they apply are the
// published ones.

/** Stable pseudo-random in [0,1) from a string, so a demo replays identically. */
function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

function reference(prefix: string, seed: string): string {
  const n = Math.floor(hashUnit(seed) * 1_000_000);
  return `${prefix}-${String(n).padStart(6, "0")}`;
}

/**
 * SHA, simulated.
 *
 * Verification, pre-authorisation, claim submission and outcome polling. A
 * submitted claim is acknowledged immediately and decided later — which is how
 * SHA actually behaves, and why the claims dashboard tracks days-to-decision
 * rather than expecting an answer at submission.
 */
const demoPayer: Adapter = (operation, request) => {
  const sim = true;
  switch (operation) {
    case "verifyMember": {
      const member = String(request.memberNumber ?? "").trim();
      if (!member) return { ok: false, error: "member number is required", retryable: false, simulated: sim };
      // A deterministic minority are inactive, so the demo can show a real
      // verification failure rather than only the happy path.
      const inactive = hashUnit(`v:${member}`) < 0.12;
      return {
        ok: true,
        simulated: sim,
        data: {
          active: !inactive,
          schemeName: "Taifa Care",
          memberNumber: member,
          status: inactive ? "inactive" : "active",
        },
      };
    }

    case "requestPreauth": {
      const services = (request.serviceCodes as string[]) ?? [];
      const summary = String(request.clinicalSummary ?? "").trim();
      if (services.length === 0) {
        return { ok: false, error: "a pre-authorisation must name the services", retryable: false, simulated: sim };
      }
      if (summary.length < 10) {
        // A real payer declines a request with no clinical justification.
        return {
          ok: false,
          error: "clinical summary is too brief for a pre-authorisation decision",
          retryable: false,
          simulated: sim,
        };
      }
      return {
        ok: true,
        simulated: sim,
        data: {
          approved: true,
          reference: reference("SHA-PA", services.join(",") + summary),
          validUntilDays: 30,
        },
      };
    }

    case "submitClaim": {
      const claimId = String(request.claimId ?? "");
      if (!claimId) return { ok: false, error: "claim id is required", retryable: false, simulated: sim };
      return {
        ok: true,
        simulated: sim,
        data: { accepted: true, reference: reference("SHA", claimId), receivedAt: now() },
      };
    }

    case "pollOutcome": {
      // The decision, once the payer has looked at it. Around one in five is
      // rejected, matching the published rate, with the documented reasons — so
      // the rejection analytics have something true to rank.
      const claimId = String(request.claimId ?? "");
      const roll = hashUnit(`o:${claimId}`);
      if (roll < 0.2) {
        const reasons = [
          { code: "E07", reason: "Supporting laboratory report not attached" },
          { code: "E11", reason: "Service not covered under the member's package" },
          { code: "E03", reason: "Pre-authorisation reference not quoted" },
        ];
        const pick = reasons[Math.floor(hashUnit(`r:${claimId}`) * reasons.length)];
        return { ok: true, simulated: sim, data: { decided: true, outcome: "rejected", ...pick } };
      }
      return { ok: true, simulated: sim, data: { decided: true, outcome: roll < 0.6 ? "accepted" : "paid" } };
    }

    default:
      return { ok: false, error: `unsupported payer operation ${operation}`, retryable: false, simulated: sim };
  }
};

/** KRA eTIMS, simulated. Assigns a canonical invoice number on transmission. */
const demoTax: Adapter = (operation, request) => {
  const sim = true;
  if (operation !== "transmitInvoice" && operation !== "transmitCreditNote") {
    return { ok: false, error: `unsupported tax operation ${operation}`, retryable: false, simulated: sim };
  }
  const provisional = String(request.provisionalNumber ?? "");
  if (!provisional) {
    return { ok: false, error: "provisional invoice number is required", retryable: false, simulated: sim };
  }
  const lines = (request.lines as unknown[]) ?? [];
  if (lines.length === 0) {
    return { ok: false, error: "an invoice must have at least one line", retryable: false, simulated: sim };
  }
  return {
    ok: true,
    simulated: sim,
    data: {
      canonicalNumber: reference(operation === "transmitInvoice" ? "KRA-INV" : "KRA-CN", provisional),
      transmittedAt: now(),
    },
  };
};

/** SMS, simulated — records what would have been sent. */
const demoSms: Adapter = (operation, request) => {
  const to = String(request.to ?? "");
  if (!/^254[71]\d{8}$/.test(to)) {
    return { ok: false, error: `"${to}" is not a valid Kenyan mobile number`, retryable: false, simulated: true };
  }
  return { ok: true, simulated: true, data: { delivered: true, to, messageId: reference("SMS", to + String(request.body ?? "")) } };
};

/** DHIS2 / KHIS, simulated — accepts a period's data values. */
const demoDhis2: Adapter = (operation, request) => {
  const values = (request.dataValues as unknown[]) ?? [];
  if (values.length === 0) {
    return { ok: false, error: "no data values to submit", retryable: false, simulated: true };
  }
  return { ok: true, simulated: true, data: { imported: values.length, period: request.period ?? "", conflicts: 0 } };
};

const DEMO_ADAPTERS: Record<string, Adapter> = {
  SHA: demoPayer,
  ETIMS: demoTax,
  SMS: demoSms,
  DHIS2: demoDhis2,
};

/** Install the endpoints a Kenyan facility needs. Idempotent. */
export function seedEndpoints(): void {
  defineEndpoint({
    code: "SHA",
    name: "Social Health Authority",
    kind: "payer",
    mode: "demo",
    notes: "Verification, pre-authorisation, claims. Live adapter awaits the SHA HMIS integration specification.",
  });
  defineEndpoint({
    code: "ETIMS",
    name: "KRA eTIMS",
    kind: "tax",
    mode: "demo",
    notes: "Electronic tax invoicing. Live adapter awaits the KRA eTIMS specification.",
  });
  defineEndpoint({
    code: "SMS",
    name: "SMS gateway",
    kind: "sms",
    mode: "demo",
    notes: "Appointment reminders and result notifications. Needs a licensed Kenyan aggregator.",
  });
  defineEndpoint({
    code: "DHIS2",
    name: "KHIS / DHIS2",
    kind: "dhis2",
    mode: "demo",
    notes: "MOH reporting. Needs facility credentials for the national instance.",
  });
}

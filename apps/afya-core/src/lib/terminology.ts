/**
 * M21 Terminology & Coding.
 *
 * "Wrong codes" is one of the named reasons SHA rejects a claim, so this module
 * has one job above all others: make the right code the fastest thing to reach,
 * and make a wrong or unverified one impossible to put on a claim.
 *
 * Two decisions follow from that:
 *
 *  1. CODES ARE LOADED, NEVER HARD-CODED.
 *     ICD-11 is a WHO release that changes; the SHA tariff schedule changes per
 *     contracting cycle. `importCodes` is the real deliverable here — the seed
 *     set exists so the system is usable on day one, not because ten codes are
 *     enough. Every row records where it came from.
 *
 *  2. UNVERIFIED CODES ARE NOT OFFERED FOR CLAIMS.
 *     A code nobody checked against the issuing authority is worse than no code:
 *     no code stops at the scrubber, a wrong one is paid for two months and then
 *     clawed back. `verified = 0` rows can be stored and searched by an
 *     administrator loading a catalogue, but `searchForCoding` will not return
 *     them.
 *
 * Favourites are the lever on the 90-second consultation budget. A Kenyan
 * outpatient clinic sees the same handful of diagnoses all day; making those one
 * tap is what keeps coding at the point of care instead of guessed later at the
 * billing desk.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { all, get, run, tx, audit, now } from "./db.ts";

export class TerminologyError extends Error {}

export const ICD11 = "ICD-11-MMS";

export interface Concept {
  system: string;
  code: string;
  term: string;
  synonyms: string;
  parent_code: string | null;
  billable: number;
  verified: number;
  source: string;
  active: number;
  loaded_at: string;
}

export interface ConceptInput {
  code: string;
  term: string;
  synonyms?: string;
  parentCode?: string | null;
  billable?: boolean;
  verified?: boolean;
}

// ------------------------------------------------------------------ loading

/**
 * Load or update a catalogue.
 *
 * Idempotent per (system, code) so a re-release can be applied over the top.
 * `source` is mandatory: a coder challenged on a code must be able to be told
 * which release it came from.
 */
export function importCodes(input: {
  system: string;
  source: string;
  concepts: ConceptInput[];
  byUserId?: number | null;
  byUserName?: string;
}): { inserted: number; updated: number } {
  if (!input.source.trim()) {
    throw new TerminologyError("a catalogue import must record its source, e.g. 'WHO ICD-11 MMS 2026-01'");
  }

  let inserted = 0;
  let updated = 0;

  tx(() => {
    for (const c of input.concepts) {
      const code = c.code.trim().toUpperCase();
      if (!code) throw new TerminologyError("a concept must have a code");
      if (!c.term.trim()) throw new TerminologyError(`concept ${code} has no term`);

      const existing = get<{ code: string }>(
        `SELECT code FROM terminology WHERE system = ? AND code = ?`,
        input.system,
        code,
      );

      run(
        `INSERT INTO terminology
           (system, code, term, synonyms, parent_code, billable, verified, source, loaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(system, code) DO UPDATE SET
           term = excluded.term,
           synonyms = excluded.synonyms,
           parent_code = excluded.parent_code,
           billable = excluded.billable,
           verified = excluded.verified,
           source = excluded.source,
           loaded_at = excluded.loaded_at`,
        input.system,
        code,
        c.term.trim(),
        (c.synonyms ?? "").trim(),
        c.parentCode ?? null,
        c.billable === false ? 0 : 1,
        c.verified ? 1 : 0,
        input.source.trim(),
        now(),
      );

      if (existing) updated++;
      else inserted++;
    }

    audit({
      action: "terminology_imported",
      entity: "terminology",
      entityId: input.system,
      actorId: input.byUserId ?? null,
      actorName: input.byUserName ?? "system",
      purpose: "administration",
      detail: { system: input.system, source: input.source, inserted, updated },
    });
  });

  return { inserted, updated };
}

// ------------------------------------------------------------------ searching

export interface SearchHit extends Concept {
  /** Higher is a better match. Used for ordering only. */
  rank: number;
  /** True when this came from the clinician's own favourites. */
  favourite: boolean;
}

/**
 * Search codes that may legitimately go on a claim.
 *
 * Only verified, active, billable concepts. Ordering puts the clinician's own
 * favourites first, then exact code matches, then term-prefix matches, then
 * anything containing the text — which is the order a person scanning a dropdown
 * actually wants.
 */
export function searchForCoding(input: {
  system?: string;
  query: string;
  userId?: number | null;
  limit?: number;
}): SearchHit[] {
  const system = input.system ?? ICD11;
  const q = input.query.trim().toLowerCase();
  if (q.length < 2) return [];

  const rows = all<Concept>(
    `SELECT * FROM terminology
      WHERE system = ? AND active = 1 AND billable = 1 AND verified = 1`,
    system,
  );

  const favourites = new Map<string, number>();
  if (input.userId) {
    for (const f of all<{ code: string; uses: number }>(
      `SELECT code, uses FROM terminology_favourites WHERE user_id = ? AND system = ?`,
      input.userId,
      system,
    )) {
      favourites.set(f.code, f.uses);
    }
  }

  const hits: SearchHit[] = [];

  for (const row of rows) {
    const code = row.code.toLowerCase();
    const term = row.term.toLowerCase();
    const synonyms = row.synonyms.toLowerCase();

    let rank = 0;
    if (code === q) rank = 100;
    else if (code.startsWith(q)) rank = 90;
    else if (term.startsWith(q)) rank = 80;
    else if (term.split(/\s+/).some((w) => w.startsWith(q))) rank = 70;
    else if (synonyms.split(",").some((s) => s.trim().startsWith(q))) rank = 65;
    else if (term.includes(q)) rank = 40;
    else if (synonyms.includes(q)) rank = 35;
    else continue;

    const uses = favourites.get(row.code);
    if (uses !== undefined) {
      // A favourite outranks everything at the same relevance, and a
      // frequently-used one outranks a rarely-used one.
      rank += 100 + Math.min(uses, 50);
    }

    hits.push({ ...row, rank, favourite: uses !== undefined });
  }

  return hits.sort((a, b) => b.rank - a.rank || a.code.localeCompare(b.code)).slice(0, input.limit ?? 12);
}

/** Look up one concept, whether or not it is verified. */
export function lookup(code: string, system = ICD11): Concept | undefined {
  return get<Concept>(`SELECT * FROM terminology WHERE system = ? AND code = ?`, system, code.trim().toUpperCase());
}

/**
 * Assert a code may go on a claim, with a message that says what to do.
 *
 * Called by the encounter before a diagnosis is attached, so a bad code is
 * stopped where the clinician can still fix it — not at the billing desk on day
 * six, and not by SHA two months later.
 */
export function assertCodable(code: string, system = ICD11): Concept {
  const concept = lookup(code, system);
  if (!concept) {
    throw new TerminologyError(
      `${code} is not in the ${system} catalogue loaded on this system. Load the current release before coding it.`,
    );
  }
  if (!concept.active) {
    throw new TerminologyError(`${code} (${concept.term}) has been retired from ${system} and cannot be claimed.`);
  }
  if (!concept.billable) {
    throw new TerminologyError(
      `${code} (${concept.term}) is a grouping, not a diagnosis. Choose a more specific code beneath it.`,
    );
  }
  if (!concept.verified) {
    throw new TerminologyError(
      `${code} (${concept.term}) has not been verified against the issuing authority, so it must not go on a claim. ` +
        `Load the official ${system} release to verify it.`,
    );
  }
  return concept;
}

// ---------------------------------------------------------------- favourites

/** Record that a clinician used a code, so it rises in their next search. */
export function noteUse(userId: number, code: string, system = ICD11): void {
  run(
    `INSERT INTO terminology_favourites (user_id, system, code, uses, last_used)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(user_id, system, code) DO UPDATE SET
       uses = uses + 1,
       last_used = excluded.last_used`,
    userId,
    system,
    code.trim().toUpperCase(),
    now(),
  );
}

/**
 * A clinician's most-used codes.
 *
 * What the consultation screen shows before anyone types anything — the tap that
 * replaces a search on most visits.
 */
export function topCodes(userId: number, system = ICD11, limit = 8): Concept[] {
  return all<Concept>(
    `SELECT t.* FROM terminology_favourites f
       JOIN terminology t ON t.system = f.system AND t.code = f.code
      WHERE f.user_id = ? AND f.system = ? AND t.active = 1 AND t.verified = 1 AND t.billable = 1
      ORDER BY f.uses DESC, f.last_used DESC
      LIMIT ?`,
    userId,
    system,
    limit,
  );
}

// ------------------------------------------------------------------ coverage

export interface Coverage {
  system: string;
  total: number;
  verified: number;
  sources: string[];
  /** True when the catalogue is too small to be the real release. */
  starterOnly: boolean;
}

/**
 * How much of a catalogue is actually loaded.
 *
 * Surfaced on the compliance dashboard. A facility running on the starter set is
 * one ICD-11 search away from a clinician not finding their diagnosis and
 * picking something close instead — which is exactly how wrong codes reach
 * claims. Better to say so loudly than to let it be discovered at 20% rejection.
 */
export function coverage(system = ICD11): Coverage {
  const row = get<{ total: number; verified: number }>(
    `SELECT COUNT(*) AS total, SUM(verified) AS verified FROM terminology WHERE system = ? AND active = 1`,
    system,
  )!;
  const sources = all<{ source: string }>(
    `SELECT DISTINCT source FROM terminology WHERE system = ? AND source <> '' ORDER BY source`,
    system,
  ).map((r) => r.source);

  const total = row.total ?? 0;
  return {
    system,
    total,
    verified: row.verified ?? 0,
    sources,
    // The real ICD-11 MMS release runs to tens of thousands of entities.
    starterOnly: system === ICD11 && total < 500,
  };
}

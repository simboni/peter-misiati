/**
 * M06 Document Store — attachments and signatures.
 *
 * "Missing documentation" is one of the named reasons SHA rejects claims, and a
 * system that cannot hold a lab report cannot tell you one is missing. Until
 * this module existed, the claim scrubber's documentation gate could only check
 * that an assessment and an invoice had been *written* — which is not the same
 * thing at all.
 *
 * Two decisions:
 *
 *  CONTENT LIVES IN THE FACILITY DATABASE. A separate blob store is another
 *  thing to back up, secure, certify and explain to an auditor, and it breaks
 *  the promise that the facility's records are one file that can be copied.
 *  Files are capped and counted; a clinic attaching a 40 MB scan is a training
 *  problem, not a storage architecture problem.
 *
 *  EVERY FILE CARRIES ITS DIGEST. A stored document whose bytes changed is
 *  detectable, the same way the audit chain makes an edited log detectable.
 *
 * A SIGNATURE IS NOT A FILE. It is a person putting their name to specific
 * content, with their licence as it stood at that moment, and a digest of what
 * they signed — so a later edit cannot hide behind the signature.
 *
 * No `next/*` imports, so this runs under `node --test`.
 */

import { createHash } from "node:crypto";
import { all, get, run, tx, audit, now } from "./db.ts";
import { mintLocalId } from "./ids.ts";
import { licenceStatus } from "./access.ts";

export class DocumentError extends Error {}

/** A scan or a report, not a film. Anything larger belongs in a PACS. */
export const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

export interface Document {
  id: string;
  facility_id: number;
  entity: string;
  entity_id: string;
  patient_mrn: string | null;
  kind: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_by: number | null;
  uploaded_at: string;
  removed_at: string | null;
}

export interface Signature {
  id: number;
  entity: string;
  entity_id: string;
  purpose: string;
  signed_by: number;
  signer_name: string;
  licence_regulator: string | null;
  licence_number: string | null;
  content_sha256: string;
  signed_at: string;
}

// ----------------------------------------------------------------- documents

export function attach(input: {
  facilityId: number;
  entity: string;
  entityId: string;
  patientMrn?: string | null;
  /** What it is: lab_report, referral, consent, id_scan, preauth_letter. */
  kind: string;
  filename: string;
  contentType: string;
  content: Buffer | Uint8Array;
  deviceCode: string;
  byUserId: number | null;
  byUserName: string;
}): string {
  const bytes = Buffer.from(input.content);

  if (bytes.length === 0) throw new DocumentError("the file is empty");
  if (bytes.length > MAX_BYTES) {
    throw new DocumentError(
      `${input.filename} is ${(bytes.length / 1_048_576).toFixed(1)} MB. The limit is ${MAX_BYTES / 1_048_576} MB — scan at a lower resolution.`,
    );
  }
  if (!ALLOWED.has(input.contentType)) {
    throw new DocumentError(
      `${input.contentType} cannot be attached. Use PDF, JPEG, PNG, WebP or plain text.`,
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // The same file attached twice to the same thing is one document, not two.
  const existing = get<Document>(
    `SELECT * FROM documents WHERE entity = ? AND entity_id = ? AND sha256 = ? AND removed_at IS NULL`,
    input.entity,
    input.entityId,
    sha256,
  );
  if (existing) return existing.id;

  const id = mintLocalId(input.deviceCode, 8);

  return tx(() => {
    run(
      `INSERT INTO documents
         (id, facility_id, entity, entity_id, patient_mrn, kind, filename, content_type,
          size_bytes, sha256, content_b64, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.facilityId,
      input.entity,
      input.entityId,
      input.patientMrn ?? null,
      input.kind,
      input.filename.trim(),
      input.contentType,
      bytes.length,
      sha256,
      bytes.toString("base64"),
      input.byUserId,
      now(),
    );

    audit({
      action: "document_attached",
      entity: input.entity,
      entityId: input.entityId,
      patientId: input.patientMrn ?? null,
      facilityId: input.facilityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      deviceCode: input.deviceCode,
      detail: { documentId: id, kind: input.kind, filename: input.filename, bytes: bytes.length, sha256 },
    });

    return id;
  });
}

/** Documents attached to something. Content is not loaded — use `read`. */
export function attachments(entity: string, entityId: string): Document[] {
  return all<Document>(
    `SELECT id, facility_id, entity, entity_id, patient_mrn, kind, filename, content_type,
            size_bytes, sha256, uploaded_by, uploaded_at, removed_at
       FROM documents WHERE entity = ? AND entity_id = ? AND removed_at IS NULL ORDER BY uploaded_at`,
    entity,
    entityId,
  );
}

/**
 * Read a document back, verifying it has not changed since it was stored.
 *
 * Reading a patient document is a disclosure, so it is audited like any other.
 */
export function read(input: {
  documentId: string;
  byUserId: number | null;
  byUserName: string;
  purpose?: "treatment" | "billing" | "claim" | "audit";
}): { document: Document; content: Buffer; intact: boolean } {
  const row = get<Document & { content_b64: string }>(
    `SELECT * FROM documents WHERE id = ?`,
    input.documentId,
  );
  if (!row) throw new DocumentError("no such document");

  const content = Buffer.from(row.content_b64, "base64");
  const intact = createHash("sha256").update(content).digest("hex") === row.sha256;

  audit({
    action: "document_read",
    entity: row.entity,
    entityId: row.entity_id,
    patientId: row.patient_mrn,
    facilityId: row.facility_id,
    actorId: input.byUserId,
    actorName: input.byUserName,
    purpose: input.purpose ?? "treatment",
    detail: { documentId: row.id, filename: row.filename, intact },
  });

  return { document: row, content, intact };
}

/** Remove an attachment. Marked, never deleted — it was part of the record. */
export function removeDocument(input: {
  documentId: string;
  reason: string;
  byUserId: number | null;
  byUserName: string;
}): void {
  const doc = get<Document>(`SELECT * FROM documents WHERE id = ?`, input.documentId);
  if (!doc) throw new DocumentError("no such document");
  if (doc.removed_at) throw new DocumentError("that document has already been removed");
  if (!input.reason.trim()) throw new DocumentError("removing a document must record why");

  tx(() => {
    run(
      `UPDATE documents SET removed_at = ?, removed_by = ? WHERE id = ?`,
      now(),
      input.byUserId,
      input.documentId,
    );
    audit({
      action: "document_removed",
      entity: doc.entity,
      entityId: doc.entity_id,
      patientId: doc.patient_mrn,
      facilityId: doc.facility_id,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "administration",
      detail: { documentId: doc.id, filename: doc.filename, reason: input.reason },
    });
  });
}

// ---------------------------------------------------------------- signatures

/**
 * Sign something.
 *
 * `content` is what is being attested to — the text of a discharge summary, the
 * lines of a claim. Its digest is stored, so if the content is later amended
 * the signature no longer matches it and `verifySignature` says so.
 */
export function sign(input: {
  entity: string;
  entityId: string;
  purpose: string;
  content: string;
  byUserId: number;
  byUserName: string;
}): number {
  const licence = licenceStatus(input.byUserId);
  const digest = createHash("sha256").update(input.content).digest("hex");

  return tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO signatures
         (entity, entity_id, purpose, signed_by, signer_name, licence_regulator, licence_number, content_sha256, signed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.entity,
      input.entityId,
      input.purpose,
      input.byUserId,
      input.byUserName,
      licence.state === "current" ? licence.regulator : null,
      licence.state === "current" ? (licence.number ?? null) : null,
      digest,
      now(),
    );
    audit({
      action: "signed",
      entity: input.entity,
      entityId: input.entityId,
      actorId: input.byUserId,
      actorName: input.byUserName,
      purpose: "treatment",
      detail: { purpose: input.purpose, licence: licence.number ?? null, contentSha256: digest },
    });
    return lastInsertRowid;
  });
}

export function signatures(entity: string, entityId: string): Signature[] {
  return all<Signature>(
    `SELECT * FROM signatures WHERE entity = ? AND entity_id = ? ORDER BY signed_at`,
    entity,
    entityId,
  );
}

export function signedFor(entity: string, entityId: string, purpose: string): Signature | undefined {
  return get<Signature>(
    `SELECT * FROM signatures WHERE entity = ? AND entity_id = ? AND purpose = ? ORDER BY signed_at DESC LIMIT 1`,
    entity,
    entityId,
    purpose,
  );
}

/**
 * Does a signature still cover the current content?
 *
 * False when the content has been amended since it was signed — which is
 * exactly the case a payer or a coroner asks about.
 */
export function verifySignature(input: {
  entity: string;
  entityId: string;
  purpose: string;
  content: string;
}): { signed: boolean; stillValid: boolean; signature?: Signature } {
  const sig = signedFor(input.entity, input.entityId, input.purpose);
  if (!sig) return { signed: false, stillValid: false };
  const digest = createHash("sha256").update(input.content).digest("hex");
  return { signed: true, stillValid: sig.content_sha256 === digest, signature: sig };
}

/** Total bytes held, for the storage line on the administration screen. */
export function storageUsed(facilityId: number): { documents: number; bytes: number } {
  const row = get<{ n: number; b: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS b FROM documents WHERE facility_id = ? AND removed_at IS NULL`,
    facilityId,
  )!;
  return { documents: row.n ?? 0, bytes: row.b ?? 0 };
}

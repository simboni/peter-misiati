import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { schema, type DB } from "./db";
import { DEFAULT_PREFIXES, formatDocNumber, type DocType } from "./numbering";

/**
 * Allocate the next document number for (org, docType) and advance the counter.
 * Uses UPDATE ... RETURNING so read+increment is a single statement.
 * Falls back to creating the sequence row if missing.
 */
export async function allocateNumber(
  db: DB,
  organizationId: string,
  docType: DocType,
): Promise<string> {
  const updated = await db
    .update(schema.numberSequence)
    .set({ nextNumber: sql`${schema.numberSequence.nextNumber} + 1` })
    .where(
      and(
        eq(schema.numberSequence.organizationId, organizationId),
        eq(schema.numberSequence.docType, docType),
      ),
    )
    .returning({
      // post-update value in SQLite; the number we just consumed is value - 1
      next: schema.numberSequence.nextNumber,
      prefix: schema.numberSequence.prefix,
      padding: schema.numberSequence.padding,
    });

  if (updated.length > 0) {
    const row = updated[0];
    return formatDocNumber(row.prefix, row.next - 1, row.padding);
  }

  // Sequence missing — create it starting at 2 and use 1.
  const prefix = DEFAULT_PREFIXES[docType];
  await db.insert(schema.numberSequence).values({
    organizationId,
    docType,
    prefix,
    nextNumber: 2,
    padding: 4,
  });
  return formatDocNumber(prefix, 1, 4);
}

/** Create the default number sequences for a new organization. */
export async function seedSequences(db: DB, organizationId: string) {
  const docTypes: DocType[] = ["invoice", "quotation", "receipt", "delivery_note"];
  await db
    .insert(schema.numberSequence)
    .values(
      docTypes.map((docType) => ({
        organizationId,
        docType,
        prefix: DEFAULT_PREFIXES[docType],
        nextNumber: 1,
        padding: 4,
      })),
    )
    .onConflictDoNothing();
}

// Cloudflare D1 rejects any single statement that binds more than 100 SQL
// variables ("too many SQL variables"). A multi-row INSERT binds one variable
// per column per row — and columns filled by $defaultFn (like id()) bind too —
// so a bulk insert of document lines silently hits the ceiling once enough
// rows are passed (e.g. 9+ invoice lines at 12 variables each).
//
// Every bulk .values(rows) call must therefore go through chunkRows() and the
// resulting statements should run inside one db.batch() so the whole write
// stays atomic — D1 rolls back the entire batch if any statement fails.

const D1_MAX_VARIABLES = 100;
/** Margin for generated columns ($defaultFn id/createdAt) not present in the row object. */
const GENERATED_COLUMNS = 3;
/** Stay a little under the hard ceiling so schema growth doesn't reintroduce the bug. */
const BUDGET = 90;

/** Split rows so each INSERT stays under D1's bound-variable ceiling. */
export function chunkRows<T extends object>(rows: T[]): T[][] {
  if (rows.length === 0) return [];
  const perRow = Object.keys(rows[0]).length + GENERATED_COLUMNS;
  const size = Math.max(1, Math.min(rows.length, Math.floor(BUDGET / perRow)));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/** Exported for tests. */
export const _limits = { D1_MAX_VARIABLES, GENERATED_COLUMNS, BUDGET };

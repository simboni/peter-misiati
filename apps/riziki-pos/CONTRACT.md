# Riziki POS — build contract

Read this before writing any code. It is the shared agreement between modules.

## The business, in one paragraph

Riziki Industrial Chemicals buys detergent chemicals in bulk drums and bags,
**repacks** them into smaller sizes for resale, **mixes** finished products from
its own formulas, and sells both to walk-in retail customers and to wholesale
buyers who often take goods **on credit**. The owner's formulas are trade
secrets. Staff must never see them, nor cost prices, nor profit.

## Non-negotiable rules

1. **Money is integer cents.** Never a float. Use `toCents` / `fromCents` /
   `formatKes` from `@/lib/units`. Columns end in `_cents`.
2. **Quantity is integer thousandths ("milli")** of the item's canonical unit
   (kg, L or pcs). `1.5 kg` is `1500`. Use `toMilli` / `fromMilli` / `formatQty`.
   Columns end in `_milli`.
3. **Stock is a ledger.** Never `UPDATE items SET qty`. Stock only changes by
   inserting into `stock_movements` via `postMovement()` from `@/lib/db`. The
   database physically blocks UPDATE and DELETE on that table.
4. **Sales are immutable.** Never delete or edit a sale. Void it: set
   `status='voided'`, record `void_reason` / `voided_by` / `voided_at`, and post
   compensating stock movements.
5. **Prices are snapshotted** onto `sale_lines.unit_price_cents` at the moment of
   sale. Reports must never re-join to `items` for price, or changing a price
   would rewrite history.
6. **Formulas are versioned.** A batch stores `formula_version_id`. Editing a
   recipe inserts a new `formula_versions` row; it never mutates an old one.
7. **Everything money- or stock-related runs inside `tx()`** so a half-recorded
   sale cannot exist.
8. **Business dates are Africa/Nairobi.** Use `businessDate()` from
   `@/lib/units`. In SQL, group by `date(at, '+3 hours')`. Grouping by raw UTC
   puts evening sales on the wrong day and makes the cash count disagree.

## Next.js 16 rules (this version has breaking changes)

- `cookies()`, `headers()`, `params` and `searchParams` are **async**. Always
  `await` them. Synchronous access was removed in 16.
  ```tsx
  export default async function Page(props: { searchParams: Promise<{ q?: string }> }) {
    const { q } = await props.searchParams;
  }
  ```
- Server Actions are `"use server"` functions. For forms needing validation
  feedback use React's `useActionState(action, initialState)` which returns
  `[state, formAction, pending]`; the action's first argument is the previous state.
- Turbopack is the default bundler. Do not add a webpack config.
- Imports **inside `src/lib/`** use explicit `.ts` extensions (`from "./db.ts"`)
  so the modules also run directly under Node for unit tests. Imports from
  `@/lib/...` in `src/app/` and `src/components/` do **not** use extensions.

## The API you build on

### `@/lib/db`
```ts
all<T>(sql, ...params): T[]          // query many
get<T>(sql, ...params): T | undefined // query one
run(sql, ...params): { lastInsertRowid, changes }
tx<T>(fn: () => T): T                 // transaction; throw to roll back
postMovement({ itemId, deltaMilli, reason, refType?, refId?, userId?, note? })
stockOf(itemId): number               // milli
chemicalStock(chemicalId): number     // milli, across every pack size
stockRows(kinds?: string[]): StockRow[]
updateAverageCost(itemId, incomingUnits, incomingCostCents)
audit(userId, action, entity, entityId?, detail?)
```
`reason` must be one of: `opening`, `purchase`, `sale`, `sale_void`,
`repack_out`, `repack_in`, `repack_loss`, `batch_consume`, `batch_output`,
`adjustment`, `stocktake`.

### `@/lib/units`
`toMilli` `fromMilli` `toCents` `fromCents` `scaleMilli(qty, target, ref)`
`formatKes` `formatAmount` `formatQty(milli, unit)` `formatUnits(milli, size, label)`
`unitsFromMilli` `businessDate` `formatDateTime` `formatDate` `pct`

### `@/lib/auth`
`currentUser()` `requireUser()` `requireOwner()` `isOwner()`
Call `requireUser()` at the top of **every** server action, and `requireOwner()`
for anything touching formulas, costs, profit or voids.

### `@/components/ui`
`Card` `PageTitle` `SectionLabel` `Chip` `Button` `LinkButton` `Field`
`inputClass` `TableWrap` `Th` `Td` `Empty` `Alert` `Stat`

## Data model quick reference

- `chemicals` — the substance (Ungerol). `canonical_unit` is kg / L / pcs.
- `items` — one stock-keeping row. `kind` is `bulk` (a 170 kg drum), `pack` (a
  20 kg repack), `finished` (a bottled product) or `packaging` (jerricans, caps).
  `size_milli` is how much ONE unit holds.
  **Stock is stored in milli of the canonical unit, not in unit count.**
  15 packs of 20 kg is `300000` (300 kg). Unit count = `qty_milli / size_milli`.
- `stock_movements` — the append-only ledger.
- `formulas` / `formula_versions` / `formula_items` — recipes, versioned.
- `batches` / `batch_lines` — production runs, with `actual_milli` yield.
- `repacks` / `repack_lines` — bulk broken into packs, with `loss_milli`.
- `sales` / `sale_lines` / `payments` — payments are multiple tenders per sale
  (cash + M-Pesa + credit on one bill).
- `customers` — credit balance is derived: `SUM(total_cents - paid_cents)`.
- `suppliers` / `purchases` / `purchase_lines`, `expenses`, `day_closes`.

## What the shop actually needs (from client research)

- **≤4 taps per sale.** The counter has a queue. No confirmation dialogs.
- **Split payments are normal**: "300 cash + 500 M-Pesa" on one sale.
- **M-Pesa codes must be unique** — the DB enforces it, so one SMS can't pay twice.
- **Haggling is normal**: a line price may be edited down to `items.floor_cents`;
  below that needs the owner. Log every override.
- **Repack loss is real** (~1.5% on Ungerol). Always show kg in vs kg out.
- **Batch yield varies** — record actual litres produced, not the theoretical target.
- **Debtors ageing is the owner's most important report.**

## Your working rules

- **Only create/edit files in the directories assigned to you.** Never modify
  `src/lib/db.ts`, `src/lib/units.ts`, `src/lib/auth.ts`, `src/lib/pin.ts`,
  `src/lib/schema.sql`, `src/lib/seed.ts`, `src/components/ui.tsx`,
  `src/components/nav.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`,
  `package.json`, `tsconfig.json` or `next.config.ts`. Another agent owns them.
- **Do not run `npx next build`** — several agents share this directory and would
  clash over `.next`. Verify with `npx tsc --noEmit` and with Node unit tests.
- **Write unit tests** for your service logic in `tests/<module>.test.ts` using
  `node --experimental-strip-types --test`. Set
  `process.env.RIZIKI_DB` to a temp file at the top so tests never touch real data.
- Write comments the way the existing code does: explain *why*, not *what*.

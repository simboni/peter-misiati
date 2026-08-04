# Dairy app — build conventions

Read this before writing any code in `dairy/`. The blueprint it implements is in
`../docs/dairy/`.

> **Next.js 16.2, not the Next.js you remember.** Read
> `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` before
> writing routing or caching code. The traps that matter most here:
> `params`/`searchParams`/`cookies()` are **always async**; `revalidateTag`
> needs a second cache-profile argument; `middleware.ts` is now `proxy.ts` and
> is Node-only; prefer `updateTag` in Server Actions for read-your-writes.

## Where things live

```
src/db/schema.ts          Every table + the domain string unions. Do not edit
                          without saying so — four agents depend on it.
src/db/index.ts           `db` (server-only). PGlite in dev/test.
src/db/test-db.ts         `createTestDb()` — throwaway in-memory Postgres.
src/lib/dal.ts            verifySession, requireCapability, assertOwned,
                          ActionResult, guard.
src/lib/session.ts        PIN hashing, session cookie.
src/lib/ids.ts            newId(), refCode(prefix).
src/lib/money.ts          num(), dec(), money(), kes(), litres(), toKg().
src/lib/domain/*.ts       Pure rules, no I/O. dates, animal, breeding, milk,
                          feed, health, payroll, sales.
src/components/ui.tsx     Card, Button, Field, TextInput, Select, Receipt,
                          SoftWarning, HardBlock, Chip, TaskTile, EmptyState.
src/server/<module>.ts    Server Actions for one module.
src/app/<module>/...      Routes for one module.
src/test/factory.ts       seedFarm, seedAnimal, seedCustomer, seedProduct,
                          seedFeedItem, seedEmployee, fakeSession, FARM_ID.
```

**Stay inside your assigned paths.** Four agents build in parallel; editing a
shared file silently breaks someone else's work. If you genuinely need a change
to `schema.ts` or `ui.tsx`, note it in your report instead of making it.

## The ten rules every screen obeys

| # | Rule |
| - | ---- |
| R1 | **≤5 fields** on a routine entry screen; at most 2–3 may block save |
| R2 | **≤10 seconds per animal, ≤3 taps** for daily capture |
| R3 | **Saving never requires the network.** Offline is the default path |
| R4 | **Warn, never block** — the single exception is antibiotic withdrawal |
| R5 | **Prefill from last known value, labelled as such** — never prefill money, drug doses or withdrawal periods |
| R6 | **Every save returns a persistent receipt** with a reference code |
| R7 | **Something useful comes back at the moment of entry**, not next month |
| R8 | **Max 2 levels of navigation.** No hamburger menu |
| R9 | **Every screen works with the text ignored** — icon, colour, position |
| R10 | **Herdsmen record, managers approve, owners read.** Provenance is permanent |

R4 is the one people get wrong. Rigid validation does not produce complete
data — it produces invented data. An implausible milk yield **saves, flagged**;
it is never rejected.

## Server Action shape

Every action, without exception:

```ts
"use server";

import { requireCapability, assertOwned, guard, actionOk, actionError, type ActionResult } from "@/lib/dal";
import { db } from "@/db";
import { newId, refCode, REF_PREFIX } from "@/lib/ids";
import { updateTag } from "next/cache";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import * as s from "@/db/schema";

const Input = z.object({ animalId: z.string().uuid(), litres: z.coerce.number().min(0) });

export async function recordSomething(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return guard(async () => {
    // 1. Capability. Server Functions are reachable by direct POST — they are
    //    an untrusted entry point, not a private helper.
    const session = await requireCapability("RECORD");

    // 2. Shape.
    const parsed = Input.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }

    // 3. OWNERSHIP. Zod checks shape, never ownership — a well-formed UUID can
    //    belong to another farm. This is the tenancy boundary.
    const animal = await db.query.animal.findFirst({
      where: and(eq(s.animal.id, parsed.data.animalId), eq(s.animal.farmId, session.farmId)),
    });
    assertOwned(animal, session, "animal");

    // 4. Write. Client-generated id + onConflictDoNothing = offline-safe.
    const id = newId();
    await db.insert(s.someTable).values({ id, farmId: session.farmId, /* … */ }).onConflictDoNothing();

    // 5. Receipt (R6) and revalidation.
    const ref = refCode(REF_PREFIX.MILK);
    await db.insert(s.receipt).values({
      id: newId(), farmId: session.farmId, refCode: ref,
      kind: "MILK", summary: `12.5 L recorded for Njeri`, actorId: session.userId, at: new Date(),
    });
    updateTag(`milk:${session.farmId}`);

    return actionOk({ id }, "12.5 L recorded for Njeri.", ref);
  });
}
```

Non-negotiable in that sequence: **capability first, ownership before write,
`farmId` in every `where`.**

### A module with actions in it must never end with a bare re-export

```ts
export { COLOSTRUM_DAYS };          // ← this disables EVERY action in the file
export { COLOSTRUM_DAYS } from "@/lib/domain/health";   // fine (has a `from`)
```

A bare `export { … };` — re-exporting a binding the module imported — makes the
Turbopack server-action transform skip the whole module. No error, no warning,
no lint. The inline `"use server"` functions simply never get action IDs, and
every POST to them returns `404 Server Action not found` at runtime.

This cost us the product. `milk.ts`, `sales.ts` and `reports.ts` each had one
such line, so the farm could not record a milking or sell a litre. It compiled,
it type-checked, and all 1,185 tests passed, because unit tests call the action
functions directly and never go through the dispatcher.

`src/server/actions-registered.test.ts` reads the source and fails if the
pattern returns. If you want to know whether a route's actions are really
registered, build and read the count:

```
.next/server/app/<route>/page/server-reference-manifest.json
```

Zero on a page that has a form is the bug, not an empty file.

### Verify in a browser, not only in vitest

Three of the worst defects found in this codebase were invisible to 1,185
passing tests: actions that 404'd, five screens that 500'd at a herdsman with a
raw error code, and a printed sheet that marked a cow ⛔ and then said "no cow
is under withdrawal today" at the foot of the same page. Unit tests call
functions; users open pages. Open the page.

## Conventions

- **Money and quantities are strings on the way in and out of the database.**
  Drizzle returns `numeric` as a string, which is correct. Convert at the edges
  with `num()` / `dec()`, never with `parseFloat` scattered through a component.
- **Dates are `YYYY-MM-DD` strings**, not `Date`. Use `src/lib/domain/dates.ts`.
  A milking on 3 August is the same fact in any timezone.
- **Put the rule in `src/lib/domain/`, the I/O in `src/server/`.** Domain
  functions must stay pure so they can be tested without a database.
- **Forms** use `useActionState`; the action's first parameter is `prevState`.
  Put `useFormStatus` in a child submit button.
- **Copy is written from the user's side.** "Do not sell Njeri's milk until
  Thursday" — not "withdrawal_period_active". Never a code like `rc=6`; that is
  the specific mistake this product exists to avoid repeating.
- **Errors say what went wrong and what to do.** No apologies, no stack traces.

## Tests

Co-locate as `*.test.ts` next to what they test. Domain tests need no database;
action and query tests use `createTestDb()` plus the factories.

Cover, at minimum: the happy path, a cross-farm access attempt (must fail), an
offline replay (must be idempotent), and the specific rule your module exists to
enforce.

```bash
npx vitest run          # all
npx tsc --noEmit        # types
```

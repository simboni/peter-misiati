# 6. Architecture

Two parts: the stack decisions, and the Next.js 16.2 facts that will bite anyone
writing this from memory.

---

## 6.1 The insight that drives every hosting decision

Two latencies matter and they are not the same:

- **Client ↔ server** — one round trip per navigation. Nairobi → Frankfurt is
  ~150–190 ms. Painful but survivable, and if the app is offline-tolerant most
  interactions never make the trip at all.
- **Server ↔ database** — *dozens* of round trips per page render. Compute in one
  region and the database in another means a 12-query dashboard costs 12 × 160 ms
  = **~2 seconds of pure network**.

**Therefore: co-locate compute and database in one region.** Never chase "a server
close to Kenya" at the cost of splitting compute from the database.

---

## 6.2 Stack decisions

| Decision | Choice | Runner-up | Why |
| -------- | ------ | --------- | --- |
| Database | **Postgres** | — | The domain is relational (herd → services → lactations → milk records → feed → vet → payroll). Lactation curves and margin reports are window functions. `jsonb` for audit payloads |
| ORM | **Drizzle** | Prisma 7 | ~33 KB, no query-engine binary, sub-500 ms cold start. Returns **plain serializable objects**, which matters because `use cache` rejects class instances and Server Action returns are serialized. SQL-shaped, with a raw-SQL escape hatch for reports |
| Auth | **Better Auth + `phoneNumber` plugin** | Supabase Auth | Phone-first is a first-class plugin, not a hand-rolled credentials provider. **Users live in our own Postgres**, so farm → role → membership are joins, not webhook-synced shadow tables. That is what makes reselling work |
| OTP delivery | **Africa's Talking** | Twilio | ~KES 0.40–0.80/SMS in Kenya vs US-centric pricing. **The CAK-approved Sender ID takes 2–5 business days and needs company letterhead — start this early** |
| Offline | **PWA + service worker + Dexie outbox** | PowerSync | A real bidirectional sync engine is the single biggest way a solo dev sinks this project. See §6.4 |
| Reports | **Print CSS → `@react-pdf/renderer` → `exceljs` → CSV** | — | Print stylesheet first, zero dependencies, works offline, Chrome on Android prints to PDF natively. Puppeteer is rejected: ~100 MB Chromium against a 50 MB serverless function limit |
| UI | Tailwind v4, matching the portfolio's setup | — | Same toolchain, no new learning curve |

**Clerk is rejected** — excellent DX, but per-MAU billing in USD is a structural
problem for a product a Kenyan farm will resell at a low price point, and it puts
the user table in someone else's system.

**Turso, Cloudflare D1 and PlanetScale are rejected** — SQLite-shaped options
weaken relational reporting and multi-tenant isolation; D1's free tier has a
**daily** row-read cliff, and a hard daily stop is unacceptable for a system a
business runs on.

---

## 6.3 Hosting under a zero budget

You chose free tiers only. Here is the honest position, because there is a
licensing trap in the obvious answer.

> **Vercel Hobby forbids commercial use.** A client's revenue-generating farm
> system on Hobby is a Terms of Service violation, and Vercel enforces it. This
> is not a technicality to route around.

That leaves two genuinely free, genuinely commercial-safe paths:

### Recommended for the build and client demo: Supabase free + Vercel Hobby

Legitimate while it is **pre-revenue development and demonstration**, not a
production business system. Free tier as of 2026: ~500 MB database, 1 GB file
storage, 5 GB egress, 50k MAU. Two catches: **projects pause after ~1 week of
inactivity** (fatal for a demo you show sporadically — keep it warm), and
**there is no African region**, so use `eu-central-1` (Frankfurt) and accept
~160 ms.

### Recommended at go-live: Oracle Cloud Always Free ARM, Johannesburg

This is the answer that actually satisfies "free tiers only" for a commercial
product, and it is *better* on latency than the paid option:

- **Always Free ARM instance** — genuinely free, indefinitely, commercial use
  permitted
- **Johannesburg region: ~35–50 ms from Nairobi**, against ~160 ms to Frankfurt
- Postgres and the Next.js app **on the same box**, so server↔database latency is
  effectively zero — which is the latency that actually matters (§6.1)
- Next.js `output: 'standalone'` in Docker, behind **Cloudflare's free plan** for
  TLS and a Nairobi PoP for static assets
- **$0/month**

The trade is real: you own backups, TLS renewal, Docker updates and monitoring.
For a solo developer that is the cost of a zero budget. Budget half a day for
setup and an hour a month thereafter.

**Build so this move is a config change, not a rewrite:** avoid Vercel-only
primitives, set a stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` from day one
(required for multi-instance and self-hosted deployments), and keep the database
plain Postgres so migration is a `pg_dump`.

### If the budget ever opens up

Vercel Pro at $20/mo with functions pinned to `fra1` and Supabase Pro at $25/mo
in `eu-central-1`. Zero ops, atomic rollbacks, preview deploys. Worth it the
moment developer hours cost more than $45/month.

---

## 6.4 Offline

Be blunt about this: **a bidirectional sync engine is how solo developers lose a
year.** Conflict resolution, client-side schema migration and partial-sync rules
are a multi-month rabbit hole.

### The v1 design, precisely scoped

1. **Installable PWA** via `app/manifest.ts` — `display: 'standalone'`, 192/512
   icons. Farmers add it to the home screen. No Play Store, no APK distribution.
2. **Service worker caches the app shell** (Workbox, or ~40 lines by hand). The
   static shell is genuinely static HTML, which is exactly what a service worker
   wants.
3. **One-way write queue, not sync.** Every form writes
   `{ id: crypto.randomUUID(), table, payload, createdAt }` into IndexedDB via
   **Dexie** and shows it immediately as pending. A background flusher drains to
   the server using Background Sync where available, with a plain `online`
   listener as fallback.
4. **Idempotency is the whole trick.** The client generates the row UUID; the
   server does `INSERT … ON CONFLICT (id) DO NOTHING`. A double-flush over a
   flaky link is harmless. **This single choice removes ~90% of offline
   complexity.**
5. **Read caching is best-effort.** Cache the herd list, feed list and today's
   milk sheet as JSON. Stale reads offline are acceptable in this domain; a lost
   milk record is not.
6. **Append-only domain modelling.** Milk records, feed issues and health events
   never update — corrections are new rows with `supersedes_id`. Conflicts become
   structurally impossible for the 95% of writes that matter. Edits and deletes
   are reserved for online-only manager screens.

**Constraint to design around:** the Server Action body limit is **1 MB** by
default. Animal photos and receipt scans must go to object storage via a signed
URL, never through an action.

**When to reach for PowerSync** (Postgres ↔ SQLite, real web SDK, free tier ~2 GB
synced/month): when the outbox queue starts hurting — not before. It is a second
backend service to operate.

---

## 6.5 Multi-tenancy

Multi-tenant from day one, as chosen.

- **`farm_id` on every table**, filtered explicitly in every query.
- **RLS as defence in depth**, with `app.farm_id` set per request from the
  verified session in the data access layer — never from a client-supplied value.
- **Users belong to farms through a membership row**, so one person can manage two
  farms (a real case: a manager running the owner's second unit) and a vet can be
  invited to one farm only.
- **No sign-up or billing surface in v1.** Farms are created by an admin. The
  schema is ready; the commercial surface comes when there is a second customer.

---

## 6.6 Repository layout

You chose to keep it in this repo. That works, with one hard constraint and one
concrete fix.

**The constraint:** `output: 'export'` and a server-rendered app **cannot share
one Next.js config**. Static export bans Server Actions, `cookies()`, Proxy,
rewrites, ISR, Draft Mode and request-reading Route Handlers outright. So the
dairy app must be a **fully independent Next.js application** in a subdirectory —
its own `package.json`, its own `next.config.ts`, its own `node_modules`, its own
deploy target. It shares nothing with the portfolio but possibly a Tailwind
preset.

```
peter-misiati/
├── src/                    ← the portfolio (static export, unchanged)
├── next.config.ts          ← output: 'export'
├── package.json            ← portfolio deps
├── tsconfig.json           ← MUST exclude dairy/  ⚠
├── docs/dairy/             ← this blueprint
└── dairy/                  ← the dairy app, fully independent
    ├── package.json
    ├── next.config.ts      ← cacheComponents: true, NO output: 'export'
    ├── tsconfig.json
    ├── drizzle.config.ts
    └── src/
        ├── app/
        ├── db/
        ├── lib/
        └── components/
```

**The concrete fix, verified in this repo:** the root `tsconfig.json` at line 27
includes `"**/*.ts"` and `"**/*.tsx"`, which would pull the dairy app into the
portfolio's type-check and break both builds. The root `exclude` must become:

```json
"exclude": ["node_modules", "dairy"]
```

The portfolio's ESLint config needs the same treatment.

> **For the record:** the architecture research recommended a *separate
> repository*, on the grounds that the two share no code, have different release
> cadences and secrets, and that a resellable client product should be able to
> change ownership without dragging a personal portfolio with it. You chose one
> repo, which is workable — the layout above keeps them genuinely independent.
> Splitting later is a `git filter-repo`, so nothing is foreclosed.

---

## 6.7 Next.js 16.2 — what actually changed

**This section is not optional reading.** The repo's `AGENTS.md` warns that this
version has breaking changes versus training data, and it is right. The
authoritative source is `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`.
Everything below is quoted or paraphrased from the local docs.

### The things that break code written from memory

| # | Change | Detail |
| - | ------ | ------ |
| 1 | **`revalidateTag` requires a second argument** | `revalidateTag('posts', 'max')`. The single-argument form is a TypeScript error. This alone breaks nearly every mutation snippet |
| 2 | **`middleware.ts` → `proxy.ts`** | And it is **Node.js-only**: "The `edge` runtime is **NOT** supported in `proxy`… Setting the `runtime` config option in Proxy will throw an error." Codemod: `npx @next/codemod@canary middleware-to-proxy .` |
| 3 | **Sync `params`/`searchParams`/`cookies()` is fully removed** | Not deprecated — removed. It was a fallback in 15; in 16 it is a hard error |
| 4 | **`opengraph-image`, `icon`, `sitemap` `id` params are now promises** | Subtle; only shows up at build time |
| 5 | **Turbopack is the default for `dev` AND `build`** | A custom webpack config now **fails the build** unless you pass `--webpack`. `turbopack` moved out of `experimental` to the top level |
| 6 | **`cacheComponents` replaces `dynamicIO` + `useCache` + `ppr`** | PPR as a flag is gone, including the `experimental_ppr` route segment |
| 7 | **Parallel routes require `default.js` in every slot** | Builds fail without them |
| 8 | **`next lint` removed** | `next build` no longer runs linting; the `eslint` config key is gone |
| 9 | **`serverRuntimeConfig` / `publicRuntimeConfig` removed** | Use env vars; call `await connection()` before reading runtime values |
| 10 | **`next/image` defaults changed** | `minimumCacheTTL` 60s → 4h; `qualities` defaults to `[75]` only; `maximumRedirects` → 3 |
| 11 | Node **20.9+**, TypeScript **5.1+** | React 19.2 |

### New APIs a pre-16 model does not know exist

- **`updateTag`** — Server Actions only, gives **read-your-writes** semantics.
  This is the modern default for mutations, not `revalidateTag`.
- **`refresh`** — refresh the client router from a Server Action.
- **`cacheLife` / `cacheTag`** — now stable, no `unstable_` prefix.
- **`'use cache: remote'`** and **`'use cache: private'`**.
- **`unstable_catchError`** from `next/error`, with `unstable_retry()`.
- **`unstable_instant`** route segment config for validated instant navigation.

### Gotchas that will bite

1. **`use cache` + `output: 'export'` is unsupported** — as are `after()` and
   Proxy. Relevant because the portfolio uses static export; the dairy app must
   not.
2. **With `cacheComponents: true`, forgetting `<Suspense>` is a build failure**,
   not a slow page: *"Uncached data was accessed outside of `<Suspense>`"*. This
   is a feature — it converts "slow page" into "build error", which is exactly
   the feedback loop you want when the target is a 3G phone.
3. **`use cache` cannot read `cookies()`/`headers()`/`searchParams`.** Read them
   outside and pass as arguments. Passing a *promise* of them causes a 50-second
   build hang.
4. **`use cache` on serverless does not persist between requests.** Self-hosted
   does. This changes what it is worth on Vercel versus the Oracle box.
5. **Class instances and `URL` objects cannot be arguments to a cached function.**
   Drizzle rows are fine; ORM model classes are not — another reason for Drizzle.
6. **Server Action dispatch is serial per client.** Do not `Promise.all` Server
   Actions from the client.
7. **A `matcher` change can silently un-protect your Server Actions.** Server
   Functions are POSTs to the route where they are used, so a matcher that
   excludes a path also skips Proxy coverage there.
8. **`cacheComponents` keeps routes mounted** via React's `<Activity>` — components
   do not unmount on navigation, so "reset the form on navigate" assumptions break.
9. **Server Action body limit is 1 MB.** Phone photos hit this immediately.
10. **Action IDs rotate at most every 14 days**, so a client on an old build can
    invoke an action ID that no longer exists — surfacing as "Failed to find
    Server Action". Relevant for a PWA that users keep open for days.

### The config we start with

```ts
// dairy/next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,                 // turn on at project start, never later
  serverExternalPackages: ['@react-pdf/renderer', 'exceljs'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
}

export default nextConfig
```

`cacheComponents` goes on **day one**. Enabling it later means retrofitting
`<Suspense>` boundaries across a finished app.

---

## 6.8 The documented patterns we follow

### Server Action that writes to the database

```ts
// app/milk/actions.ts
'use server'

import { updateTag } from 'next/cache'
import { verifySession } from '@/lib/dal'
import { db } from '@/db'

export async function recordMilk(prevState: unknown, formData: FormData) {
  const session = await verifySession()          // EVERY action. No exceptions.
  if (session.role === 'ACCOUNTANT') return { error: 'Not permitted' }

  // Ownership is derived from the session, never trusted from the client
  const animal = await db.query.animal.findFirst({
    where: (a, { and, eq }) => and(
      eq(a.id, String(formData.get('animalId'))),
      eq(a.farmId, session.farmId),              // ← the tenant guard
    ),
  })
  if (!animal) return { error: 'Not found' }

  await db.insert(milkRecord).values({ /* … */ }).onConflictDoNothing()
  updateTag(`milk:${session.farmId}`)
  return { ok: true }
}
```

Two rules from the docs that are easy to skip and expensive to skip:

> "Server Functions are reachable via direct POST requests, not just through your
> application's UI. **Always verify authentication and authorization inside every
> Server Function.**"

> "Schema validation (zod or similar) only checks the *shape* of the input. A
> well-formed `Item` object can still refer to a row the caller does not own."

For a multi-tenant system the second rule *is* the tenancy boundary. Zod will
happily validate a perfectly-formed UUID belonging to another farm.

### The data access layer is the real security boundary

```ts
// lib/dal.ts
import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const verifySession = cache(async () => {
  const cookie = (await cookies()).get('session')?.value
  const session = await decrypt(cookie)
  if (!session?.userId) redirect('/login')
  return { userId: session.userId, farmId: session.farmId, role: session.role }
})
```

Proxy does **optimistic checks only** — read the session from the cookie, never
hit the database, because Proxy runs on every route including prefetches. And per
the docs: **do not put auth checks in layouts** (they don't re-render on
navigation), and `return null` in a component is not a security boundary.

### Forms

`useActionState` + server-side Zod. Note the signature change: with
`useActionState` the action's first parameter is `prevState`. `useFormStatus` goes
in a **child** `SubmitButton` component. `useOptimistic` gives the milk sheet its
instant feel.

`next/form` is a **different thing** — it's for forms that update URL search
params with prefetching, not for mutations. Useful for the herd list filter.

---

## 6.9 Security posture

| Concern | Measure |
| ------- | ------- |
| Tenant isolation | `farm_id` filter in every query **and** RLS. Two locks |
| Server Actions as public endpoints | `verifySession()` first line of every action; ownership derived from session |
| PIN auth on shared phones | Argon2-hashed 4-digit PINs, rate-limited, auto-logout to the person picker after ~60 s idle |
| Money entries by staff | `PENDING` until manager approval; no effect on reports until approved |
| Audit | Every insert, update and approval recorded with actor and timestamp |
| Multi-instance / self-hosted | Stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` from day one |
| Photos and receipts | Signed-URL upload to object storage, never through a Server Action |
| Withdrawal enforcement | Server-side, in the disposal path — not a client-side warning |

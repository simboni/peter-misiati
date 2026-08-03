# Billing platform — agent notes

Multi-tenant (SaaS) billing & invoicing app. **Separate** from the marketing site
at the repo root — do not couple them.

## This is NOT the Next.js you know
Next.js 16 + React 19 have breaking changes vs. older training data. Before writing
app code, read the relevant guide in `node_modules/next/dist/docs/`. Key ones already
confirmed for this app:
- `params`, `searchParams`, `cookies()`, `headers()` are **async** — always `await` them.
- Server Actions: `'use server'` file/function; invoked from `<form action={...}>`.

## Stack
- Next.js 16 App Router + Server Actions, React 19, TypeScript, Tailwind v4
- Cloudflare **D1** (SQLite) via **Drizzle ORM**; migrations in `./drizzle`
- **better-auth** + organization plugin (multi-tenant), Drizzle adapter
- Hosting: **@opennextjs/cloudflare** + wrangler. Bindings via `getCloudflareContext()`.

## Rules that matter
- **Money is integer minor units** (KES cents). VAT rates are **basis points** (1600 = 16%).
  Never store money as floats. All math goes through `src/server/totals.ts` / `money.ts`.
- **Every** business query is scoped to the caller's org via `requireOrg()`
  (`src/server/org.ts`). No table is read/written without an `organizationId` filter.
- The D1 binding is `env.DB`. Get it with `await getCloudflareContext({ async: true })`.

## Common commands
```bash
npm run dev                 # next dev (local D1 via miniflare)
npm run db:generate         # drizzle-kit generate -> ./drizzle/*.sql
npm run db:migrate:local    # apply migrations to local D1
npm run cf:build            # opennextjs-cloudflare build (production bundle)
```

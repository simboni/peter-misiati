# Tally — Multi-vendor Billing & Invoicing Platform

A simple, multi-tenant (SaaS) billing app for freelancers and small businesses.
Each business signs up, gets an isolated workspace, and runs its whole money-and-delivery
cycle: **quotation → invoice (with deposit) → balance → receipt**, plus **delivery notes**,
clients, a service catalogue, and a money dashboard. Built for Kenya (VAT 16%, KRA PIN).

This app is **separate** from the marketing site in the repository root and has its own
toolchain and deploy.

## Stack

- **Next.js 16** (App Router, Server Actions) · React 19 · TypeScript · Tailwind v4
- **Cloudflare D1** (SQLite) via **Drizzle ORM** — migrations in [`drizzle/`](drizzle)
- **better-auth** + organization plugin (multi-tenant auth)
- **@opennextjs/cloudflare** + Wrangler for hosting on Cloudflare Workers
- Money is stored as **integer minor units** (KES cents); VAT rates as **basis points**.
  All arithmetic goes through [`src/server/totals.ts`](src/server/totals.ts) (unit-tested).

Every business query is scoped to the caller's organization via `requireOrg()`
([`src/server/org.ts`](src/server/org.ts)) — the core tenant-isolation guarantee.

## Local development

```bash
cd billing
npm install
cp .dev.vars.example .dev.vars      # set BETTER_AUTH_SECRET (openssl rand -base64 32)

npm run db:generate                 # (only after changing src/server/db/schema.ts)
npm run db:migrate:local            # create tables in the local D1
npm run dev                         # http://localhost:3000
```

Run the accounting unit tests:

```bash
npm test
```

## Deploying to Cloudflare

1. **Create the D1 database** and copy the printed `database_id` into
   [`wrangler.jsonc`](wrangler.jsonc) (`d1_databases[0].database_id`):

   ```bash
   npx wrangler d1 create billing-db
   ```

2. **Apply migrations to the remote database:**

   ```bash
   npm run db:migrate:remote
   ```

3. **Set secrets** (production values):

   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET     # a long random string
   npx wrangler secret put BETTER_AUTH_URL        # e.g. https://app.yourdomain.co.ke
   # optional email delivery (see below)
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put RESEND_FROM
   ```

4. **Build & deploy the Worker:**

   ```bash
   npm run cf:deploy       # = opennextjs-cloudflare build && ... deploy
   ```

   Add your custom domain (e.g. `app.yourdomain.co.ke`) to the Worker in the
   Cloudflare dashboard and set `BETTER_AUTH_URL` to match.

## Sending documents to clients

Every invoice, quotation, receipt and delivery note has a **public share link**
(`/d/<token>`) with a clean, A4 **Print / Save as PDF** view. From that page you can also
**Copy link**, send via **WhatsApp**, or open your **email** client — no setup required.

*Server-side email (optional):* set `RESEND_API_KEY` + `RESEND_FROM` to enable transactional
email via [Resend](https://resend.com) (requires a verified sending domain). Hook points are
noted in the code; this is the recommended first enhancement.

## What's included (first release)

Clients · service/product catalogue · quotations → invoices · invoices with **deposit +
running balance**, discounts and **16% VAT** · receipts (deposit / partial / balance / full) ·
delivery notes · print/share document views · money **dashboard** (invoiced / received /
outstanding / overdue / month revenue / top clients) · business settings (KRA PIN, VAT,
numbering, bank details, branding).

## Designed-in for later

M-Pesa STK-push (Daraja) · multi-currency books · withholding tax/VAT · expenses & overheads ·
P&L, VAT and receivables-aging reports · team members per workspace · recurring/retainer
invoices · subscription tiers.

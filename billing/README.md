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

## Continuous deploy (GitHub Actions)

`.github/workflows/deploy-billing.yml` builds and deploys this app on every push that
touches `billing/` — so after a one-time setup you get a fresh live URL automatically.

1. Do steps 1–3 above **once** (create the D1 database + paste its id into `wrangler.jsonc`,
   and set the Worker secrets). The workflow reuses those.
2. Add two **repository** secrets (GitHub → Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` — a token with *Workers Scripts: Edit*, *D1: Edit*, *Workers KV/R2*
     as needed (the "Edit Cloudflare Workers" template works).
   - `CLOUDFLARE_ACCOUNT_ID` — your account id (Cloudflare dashboard → Workers & Pages).
3. Push. The workflow runs the tests, applies D1 migrations (`--remote`), then builds and
   deploys. Your live URL is `https://billing-platform.<account>.workers.dev` (shown in the
   deploy step's logs). Set `BETTER_AUTH_URL` to that URL once and everything resolves.

You can also trigger it manually from the **Actions** tab (Run workflow).

## Sending documents to clients

Every invoice, quotation, receipt and delivery note has a **public share link**
(`/d/<token>`) with a clean, A4 **Print / Save as PDF** view. From that page you can also
**Copy link**, send via **WhatsApp**, or open your **email** client — no setup required.

**Email a link automatically (Resend).** Set `RESEND_API_KEY` (and optionally `RESEND_FROM`,
a verified sender) and the **Email to client** button on an invoice/quotation sends the client
a branded email — pulling their address from the client record — with a button that opens the
document (and, for unpaid invoices, the Pay button). Without a key, use copy-link / WhatsApp.

**Downloadable PDF (Cloudflare Browser Rendering).** Every share page has an instant
**Print / Save as PDF**. In addition, when the `BROWSER` binding (declared in `wrangler.jsonc`)
is enabled on your account, a **Download PDF** button appears that renders a true A4 PDF at
`/d/<token>/pdf`. For unpaid invoices the PDF includes a **clickable "Pay this invoice online →"**
link that opens the pay page — so a forwarded PDF can still be paid by M-Pesa. If the binding
isn't enabled the button is simply hidden (and the route returns 501). Enable Browser Rendering
for your Worker in the Cloudflare dashboard; no code change needed.

## Collecting money by M-Pesa (Kopo Kopo STK push)

When Kopo Kopo secrets are set, the shared invoice page shows a **Pay with M-Pesa** button.
The client enters an amount (full or partial) and their phone; an STK prompt pops on their
phone; on approval Kopo Kopo calls our webhook, we record the payment and issue a numbered
**receipt**, and the page flips to **Paid ✓**. If a client pays offline instead, you record it
on the Tally side exactly as before — both routes land in the same ledger.

Set these secrets (use the **sandbox** first):

```bash
npx wrangler secret put KOPOKOPO_BASE_URL      # https://sandbox.kopokopo.com  (prod: https://api.kopokopo.com)
npx wrangler secret put KOPOKOPO_CLIENT_ID
npx wrangler secret put KOPOKOPO_CLIENT_SECRET
npx wrangler secret put KOPOKOPO_API_KEY        # used to verify the result webhook signature
npx wrangler secret put KOPOKOPO_TILL_NUMBER    # your till / online account number
```

The **result webhook URL** to register (or that we pass as the callback) is:

```
https://<your-app-domain>/api/mpesa/kopokopo
```

Webhook calls are rejected unless the `X-KopoKopo-Signature` (HMAC-SHA256 of the raw body with
your API key) matches. A polling fallback (`/api/payments/status`) also reconciles the payment
if the webhook can't reach the app.

**Platform vs. per-vendor accounts.** The secrets above are the **platform-level** account (one
till — ideal for a pilot). In addition, each vendor can enter **their own** Kopo Kopo credentials
under **Settings → M-Pesa collection**, so payments land in their account. Those secrets are
**encrypted at rest** (AES-GCM, key derived from `BETTER_AUTH_SECRET`) and each vendor's
confirmation webhook is verified with **their own** API key. When a vendor hasn't set their own,
the platform account is used as the fallback.

## What's included

Clients · service/product catalogue · quotations → invoices · invoices with **deposit +
running balance**, discounts and **16% VAT** · receipts (deposit / partial / balance / full) ·
delivery notes · print/share document views · **email a pay link to clients (Resend)** ·
**M-Pesa STK push collection (Kopo Kopo)** with automatic receipting · money **dashboard**
(invoiced / received / outstanding / overdue / month revenue / top clients) · business settings
(KRA PIN, VAT, numbering, bank details, branding).

## Designed-in for later

Multi-currency books · withholding tax/VAT · expenses & overheads · P&L, VAT and
receivables-aging reports · team members per workspace · recurring/retainer invoices ·
subscription tiers.

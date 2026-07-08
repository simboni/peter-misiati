# Go-live guide — Tally on your own domain

A single, ordered checklist to take the billing app from the repo to
`https://app.yourdomain.co.ke`. Do these once; after that, every `git push`
redeploys automatically (via the GitHub Action).

Assumes: `<DOMAIN>` = the hostname you'll serve the app on, e.g.
`app.yourdomain.co.ke`.

---

## 0. Prerequisites

- A **Cloudflare account** (free tier is fine).
- Your **domain added to Cloudflare** (change the registrar's nameservers to the
  two Cloudflare gives you; wait for it to show **Active** in the dashboard).
- `wrangler` logged in on your machine (`npx wrangler login`) — only needed for
  the manual path or first-time D1 creation.

> The whole app runs as **one Cloudflare Worker** named `billing-platform`
> (see `wrangler.jsonc`). It is **not** the `pages.dev` site — that's the
> separate static marketing site at the repo root.

---

## 1. Create the database (once)

```bash
cd billing
npx wrangler d1 create billing-db
```

Copy the printed `database_id` into `billing/wrangler.jsonc` →
`d1_databases[0].database_id` (replacing `local-placeholder-id`). Commit that change.

Create the tables on the remote DB:

```bash
npm run db:migrate:remote
```

---

## 2. Set the three required secrets

Only **three** values must live in the environment. Everything else (platform
M-Pesa keys, email keys, pricing) is configured later from the **admin UI**.

```bash
cd billing
npx wrangler secret put BETTER_AUTH_SECRET   # any long random string (e.g. `openssl rand -base64 32`)
npx wrangler secret put BETTER_AUTH_URL      # https://<DOMAIN>   ← the real URL
npx wrangler secret put OWNER_EMAILS         # your login email → becomes super-admin
```

> **`BETTER_AUTH_URL` is the single source of truth.** It drives sign-in, the
> public share links on documents, **and** the M-Pesa callback URL
> (`https://<DOMAIN>/api/mpesa/kopokopo`). Get it right and M-Pesa "just works" —
> there is **no separate webhook to register** in the Kopo Kopo dashboard.

---

## 3. Deploy

**Automatic (recommended)** — add two repository secrets in GitHub → Settings →
Secrets and variables → Actions:

- `CLOUDFLARE_API_TOKEN` (a token with *Edit Workers* + *D1* permissions)
- `CLOUDFLARE_ACCOUNT_ID`

Then push to your branch. The **Deploy billing app** workflow runs the tests,
applies migrations, and deploys. Every subsequent push redeploys.

**Manual (one-off):**

```bash
cd billing && npm run cf:deploy
```

---

## 4. Point the domain at the Worker

In the Cloudflare dashboard → **Workers & Pages → `billing-platform` → Settings
→ Domains & Routes → Add → Custom domain**, enter `<DOMAIN>`. Cloudflare creates
the DNS record and TLS certificate automatically (a minute or two).

Confirm `https://<DOMAIN>` loads the Tally landing page.

> If you deployed *before* setting `BETTER_AUTH_URL`, set it now (step 2) and
> redeploy — auth and share links must match the live host.

---

## 5. First login → become super-admin

1. Go to `https://<DOMAIN>/signup` and register with the **same email** you put
   in `OWNER_EMAILS`.
2. On first load of `/admin` you're auto-promoted to **super-admin**.
3. Open the **Admin console** (link in the sidebar, or `/admin`).

---

## 6. Configure the platform from the admin UI

Admin → **Platform settings** (super-admin only). No redeploy needed — these are
stored (encrypted) in the database:

- **Pricing** — the Pro (white-label) price per user / month.
- **Platform M-Pesa (Kopo Kopo)** — the fallback account that collects for
  vendors who haven't connected their own. Enter Base URL
  (`https://api.kopokopo.com` for live), Till, Client ID, Client Secret, API Key.
- **Email (Resend)** — API key + a From address (see step 7).

Admins & vendors are then managed entirely in-app: **Vendors** (activate Pro,
suspend, price overrides), **Upgrade requests**, **Users & admins**, **Payments**,
**Audit log**.

---

## 7. Two integrations that need their own accounts

**M-Pesa (Kopo Kopo).** Use your **live** credentials and Base URL
`https://api.kopokopo.com`. Because the callback URL is derived from
`BETTER_AUTH_URL`, no dashboard webhook setup is required. Each vendor can also
connect **their own** Kopo Kopo account under **Settings → M-Pesa collection**;
otherwise the platform account (step 6) is used.

**Email (Resend).** To send from `billing@yourdomain.co.ke`, add and **verify
your domain** in the Resend dashboard (it gives you DNS records to add in
Cloudflare). Until then, email is optional — the app falls back to copy-link /
WhatsApp / mailto.

---

## 8. Smoke test (5 minutes)

- [ ] `https://<DOMAIN>` loads; sign up + log in works.
- [ ] Create a client → an item → an invoice with a deposit + 16% VAT; totals look right.
- [ ] Open the invoice's public share link; it shows the **Powered by Tally** mark (free plan).
- [ ] Record a payment → a numbered receipt is produced; balance updates.
- [ ] `/admin` shows your workspace; activate **Pro** on it → the share link's Tally mark disappears and your template/colour/logo apply.
- [ ] (If M-Pesa live) a small **Pay with M-Pesa** test settles and auto-creates a receipt.

---

## Rollback / notes

- Redeploy any previous commit by pushing it (or `npm run cf:deploy` from that
  checkout). Migrations are additive — no destructive steps in this app.
- To add more admins later, do it in **Admin → Users & admins** (no env change).
- Rotate any credential from **Admin → Platform settings** or
  `wrangler secret put …`; secrets are AES-GCM encrypted at rest in the DB.

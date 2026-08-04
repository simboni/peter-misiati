# Sandbox — test every module before the domain exists

Both routes below give you a **real HTTPS URL** (a free, random
`….trycloudflare.com` address) with no domain, no Cloudflare account and no
cost. HTTPS being real matters: it means offline mode, add-to-home-screen and
the Bluetooth receipt printer all behave exactly as they will in production —
so what you test is what the client gets.

## Route 1 — with Docker

```bash
cd apps/riziki-pos
docker compose -f docker-compose.sandbox.yml up --build
```

Watch the logs for the `https://….trycloudflare.com` line — that's your
sandbox. Data lives in `sandbox-data/`, completely separate from any real
deployment; delete that folder to reset to a freshly seeded shop.

## Route 2 — no Docker, just Node 22+

```bash
cd apps/riziki-pos
bash scripts/sandbox.sh
```

Same result: the script builds, starts the POS, fetches the tunnel binary
once, and prints the URL.

## What to test once you're in

Sign in as **Owner, PIN 1234** (attendant: PIN 1111) — the shop seeds itself
with Riziki's real chemicals, formulas and opening stock on first load.

A worthwhile circuit, on a phone:

1. Install it: browser menu → *Add to Home screen*, then open from the icon.
2. **Sell** — retail sale, haggle a price, split tender cash + M-Pesa; then a
   wholesale sale on credit to Mama Njeri.
3. Flight mode on → sell again → flight mode off → watch it sync.
4. **Debts** — record a partial payment, print the customer statement.
5. **Invoice** — open the credit sale, print the A5 invoice; pair a thermal
   printer under *More → Receipt printer* if you have one.
6. **Batch** — mix 20 L of Toilet Cleaner, record the yield, void it, watch
   the chemicals return on **Stock**.
7. **Products & prices** — add a product, change a price, see it at the
   counter immediately.
8. **Reports → Download full backup** — the restore file, working day one.
9. As the owner will: **Day close**, count the drawer.

Then sign in as the attendant on a second phone and confirm what they *can't*
see: no Batch, no Reports, no reagent quantities, no costs.

## The honest limits of a sandbox

- The URL changes each time the tunnel restarts — bookmark nothing.
- Quick tunnels have no uptime promise. Fine for testing, wrong for a shop.
- When the domain arrives, the real path is `DEPLOY.md` — same app, same
  data shape, just Caddy and a fixed address instead of the tunnel.

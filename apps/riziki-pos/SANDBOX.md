# Sandbox — test every module before the domain exists

Three routes, all giving a **real HTTPS URL** with no domain. HTTPS being
real matters: it means offline mode, add-to-home-screen and the Bluetooth
receipt printer all behave exactly as they will in production — so what you
test is what the client gets.

**Route 0 is the recommended one**: it runs on the server you'll keep, so
the sandbox *becomes* production when the domain arrives.

## Route 0 — on the real VPS, no domain needed (recommended)

A domain is not required for HTTPS. Free wildcard DNS (`sslip.io`) maps any
IP to a hostname — `203.0.113.7` answers as `pos.203-0-113-7.sslip.io` — and
Caddy fetches a genuine Let's Encrypt certificate for it automatically.

```bash
# On a fresh Ubuntu VPS (Hetzner/DigitalOcean, ~€4/month):
curl -fsSL https://get.docker.com | sh
git clone <your-repo> && cd <repo>/apps/riziki-pos

# Put the IP-based hostname in deploy/Caddyfile — with the server's real IP,
# dots replaced by dashes:
#   pos.203-0-113-7.sslip.io {
#       reverse_proxy pos:3100
#   }

docker compose up -d --build
```

Open `https://pos.<your-ip-with-dashes>.sslip.io` on any phone. Stable URL,
no tunnel, no uptime caveats — this **is** the production stack under a
temporary name. When the domain arrives: change that one Caddyfile line to
the real hostname, `docker compose restart caddy`, done. If you want to
reset the data before going live, stop the app and delete `data/`.

## Routes 1 & 2 — no server yet: tunnel from your own machine

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

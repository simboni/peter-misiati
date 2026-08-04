# Deploying Riziki POS

The system is one Node server holding one SQLite file. That file **is** the
business — sales, stock, formulas, debts — so this guide is mostly about
putting the server somewhere reliable and copying that file somewhere safe,
every night, automatically.

**Why a server with HTTPS, and not just a laptop at the shop:** the counter
phone installs the POS as an app and keeps selling when the network drops.
Both of those (service worker, home-screen install) only work over HTTPS on a
real domain. A bare `http://192.168.x.x:3100` still works as a website, but
offline mode — the feature the counter depends on — will not switch on.

## What you need

- A small VPS — 1 vCPU / 1 GB is plenty (Hetzner, DigitalOcean, Contabo…).
  The database after three busy years is measured in tens of megabytes.
- A domain or subdomain for the POS (e.g. `pos.rizikichem.co.ke`) with an
  A record pointing at the VPS. The marketing site can share the same box.
- Docker and Docker Compose on the VPS (`curl -fsSL https://get.docker.com | sh`).

## First deployment

```bash
# On the VPS:
git clone <your-repo> && cd <repo>/apps/riziki-pos

# 1. Put the real domain in deploy/Caddyfile (replace pos.example.co.ke).
# 2. Start everything:
docker compose up -d --build

# 3. Watch it come up:
docker compose logs -f pos
```

Open `https://pos.your-domain` — the login screen seeds the database with the
shop's chemicals, formulas and opening stock on first load.

## The go-live checklist (do these with the owner, in order)

1. **Sign in as Owner (PIN 1234) and change it immediately** — Users &
   settings. The home screen shows a red banner until every shipped PIN is
   gone. Add each attendant with their own PIN; delete nobody shares accounts.
2. **Shop details** — business name, phone, KRA PIN, cash float
   (Users & settings). These print on every invoice.
3. **Walk the stock** — Stock take, correct anything the seed got wrong.
   The seed's opening numbers came from the client's paper sheet and are only
   as current as that sheet.
4. **Prices** — Products & prices: confirm retail/wholesale/floor on the
   items that actually move.
5. **On the counter phone**: open the site in Chrome → menu → *Add to Home
   screen*. Then turn on flight mode and confirm the Sell screen still loads —
   that is the offline mode working.

## Backups — set this up the same day

Nightly snapshot on the server (cron on the VPS host):

```bash
crontab -e
# 2:30 am Nairobi time, every night:
30 2 * * * docker compose -f /path/to/apps/riziki-pos/docker-compose.yml exec -T pos npm run backup
```

Snapshots land in `data/backups/`, keep 30 days, and each one is
integrity-checked before it counts. They protect against mistakes, not
against the server dying — so also:

- **Weekly, off the server**: the owner taps *Download full backup* on the
  Reports screen and the file goes to their phone/Drive/email. Two taps.

**Restoring** = stop the app, put the chosen snapshot back as
`data/riziki.db` (delete any `riziki.db-wal`/`riziki.db-shm` beside it),
start the app:

```bash
docker compose stop pos
cp data/backups/riziki-2026-08-01.db data/riziki.db
rm -f data/riziki.db-wal data/riziki.db-shm
docker compose start pos
```

## Updating the app

```bash
git pull
docker compose up -d --build
```

The database is in the mounted `data/` directory, untouched by rebuilds.
Schema additions apply themselves on boot (`CREATE TABLE IF NOT EXISTS` plus
runtime column patches), so an update never needs a migration step by hand.

## The marketing website

`apps/riziki-web` exports to static files (`npm run build` → `out/`). Host it
anywhere static — Cloudflare Pages and Netlify are free and take the `out/`
directory as-is — on the main domain, with the POS on the `pos.` subdomain.

## If something goes wrong

- **App won't start**: `docker compose logs pos`. The commonest cause after
  an update is a half-pulled build — rerun `docker compose up -d --build`.
- **"No space left"**: check `data/backups/` hasn't been set to keep more
  than 30, and `docker system prune` old images.
- **Wrong numbers on screen**: don't edit the database by hand — every
  correction has an in-app path (void the sale/batch/repack, stock take,
  record a payment). Hand edits are blocked by triggers for exactly this
  reason, and the audit log stops meaning anything if they weren't.

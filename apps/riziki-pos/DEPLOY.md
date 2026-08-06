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
- The domain: **rizikichemicals.co.ke** (already baked into the site's SEO
  tags as the canonical origin).
- Docker and Docker Compose on the VPS (`curl -fsSL https://get.docker.com | sh`).

## DNS — three A records, all to the VPS's IP

| Host | Type | Value | Serves |
| --- | --- | --- | --- |
| `rizikichemicals.co.ke` | A | VPS IP | the marketing site |
| `www.rizikichemicals.co.ke` | A | VPS IP | redirect to the bare domain |
| `pos.rizikichemicals.co.ke` | A | VPS IP | the shop system |

Set these at the registrar (or better, point the domain's nameservers at a
free Cloudflare account first and manage DNS there). Caddy fetches all three
HTTPS certificates itself once the records resolve.

## First deployment

```bash
# On the VPS:
git clone <your-repo> && cd <repo>/apps/riziki-pos

# Everything — shop system, website, HTTPS:
docker compose up -d --build

# Watch it come up:
docker compose logs -f
```

Open `https://rizikichemicals.co.ke` for the site and
`https://pos.rizikichemicals.co.ke` for the POS — the login screen seeds the
database with the shop's chemicals, formulas and opening stock on first load.

Then check it for real, rather than trusting it:

```bash
sh deploy/smoke.sh
```

That fetches every public page and every picture on the site, plus the POS
login screen, and prints ok/FAIL per URL. It is the last step of every deploy.

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
5. **Credit limits** — Debts, one number per regular. This is not optional
   paperwork: a customer with no limit set cannot be sold to on credit without
   the owner's PIN, by design. Set limits for the names that buy on account and
   the counter stops needing him; leave them unset for everyone else and it
   stays his decision.
6. **On the counter phone**: open the site in Chrome → menu → *Add to Home
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

## Updating — app and website together

```bash
sh /root/peter-misiati/apps/riziki-pos/deploy/update.sh
```

That is the whole update, for both the shop system and the public website: it
checks out the deploy branch, rebuilds both containers, reloads Caddy and then
smoke-tests every public URL.

**Use the script rather than `git pull` by hand.** `git pull` updates whatever
branch the server happens to be sitting on, and a server parked on the wrong
branch is indistinguishable from an up-to-date one — the build succeeds, the POS
restarts, and none of the work that was pushed is anywhere on the disk. That is
a real failure this shop had: the public website was months behind and nobody
could see why. The script pins the branch (override with `RIZIKI_BRANCH=…`).

There is no separate website step either, deliberately: there used to be, and
the result was the same silence — a server serving a months-old website while
the POS was current. The site is now built from the checked-out commit inside
`docker compose up --build`, so it cannot drift, and `smoke.sh` says so out loud
either way.

The database is in the mounted `data/` directory, untouched by rebuilds.
Schema additions apply themselves on boot (`CREATE TABLE IF NOT EXISTS` plus
runtime column patches), so an update never needs a migration step by hand.

## The marketing website

Its own container (`apps/riziki-web/Dockerfile`): a Node stage runs the static
export, and the result is copied into a small Caddy image that serves it on
port 80 inside the compose network. The edge Caddy terminates HTTPS for the
bare domain and proxies to it; www redirects there.

To rebuild only the website: `docker compose up -d --build web`.

(If you ever want it off the VPS, `npm run build` in `apps/riziki-web` still
produces a plain `out/` directory that drops straight into Cloudflare Pages or
Netlify — nothing about the build changes.)

## If something goes wrong

- **App won't start**: `docker compose logs pos`. The commonest cause after
  an update is a half-pulled build — rerun `docker compose up -d --build`.
- **Website pages or pictures 404** (`smoke.sh` shows FAIL on `/products/` or
  `/art/*.svg`): the site container is behind the checked-out code.
  `git pull && docker compose up -d --build web`, then smoke it again.
- **"No space left"**: check `data/backups/` hasn't been set to keep more
  than 30, and `docker system prune` old images.
- **Wrong numbers on screen**: don't edit the database by hand — every
  correction has an in-app path (void the sale/batch/repack, stock take,
  record a payment). Hand edits are blocked by triggers for exactly this
  reason, and the audit log stops meaning anything if they weren't.

# 64theatre on the Contabo box — no domain required

You don't need a domain to get real HTTPS. `sslip.io` is free wildcard DNS that
maps any IP to a hostname, and Caddy fetches a genuine Let's Encrypt certificate
for it. This is the repo's own "Route 0" approach, applied to your server:

```
https://64theatre.169-58-127-122.sslip.io
```

Real certificate, stable URL, no tunnel — so the PWA, the offline gate scanner
and add-to-home-screen all behave exactly as they will in production. When the
domain arrives you change two lines and reload.

**Shape:** one container (nginx + PHP-FPM), SQLite on a volume, demo content
seeded on boot, fake payment gateway. **~250 MB RAM**, capped at 512 MB. No
Postgres, no Redis, no worker — the staging config runs jobs inline.

---

## Deploy

```bash
mkdir -p /srv/64theatre
git clone --depth 1 https://github.com/simboni/64theatre-platform /srv/64theatre/repo

cd /srv/smp-portfolio/repo && git pull
cp deploy/contabo/64theatre/compose.yml deploy/contabo/64theatre/env.example /srv/64theatre/

cd /srv/64theatre
cp env.example .env && chmod 600 .env
```

Set a real `APP_KEY` **before** building — compose validates it even for a
build, and Laravel's key is just `base64:` plus 32 random bytes, so no image
is needed to make one:

```bash
sed -i "s|^APP_KEY=.*|APP_KEY=base64:$(openssl rand -base64 32)|" /srv/64theatre/.env
grep -c '^APP_KEY=base64:' /srv/64theatre/.env    # must print 1
```

Then build:

```bash
docker compose -f /srv/64theatre/compose.yml build
```

`APP_URL` is already set to the sslip.io hostname for this server. Start it:

```bash
docker compose -f /srv/64theatre/compose.yml up -d
docker compose -f /srv/64theatre/compose.yml logs -f app   # ctrl-C once booted
```

Confirm nothing else moved:

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
```

## Verify before touching anything shared

```bash
docker exec edge-caddy wget -qO- http://64theatre:8080/up
```

`/up` is Laravel's health endpoint — it should return a short HTML page.

## Publish

```bash
cat > /srv/edge/sites/64theatre.caddy <<'EOF'
# 64theatre — ticketing platform (temporary sslip.io host until the domain exists)

64theatre.169-58-127-122.sslip.io {
	reverse_proxy 64theatre:8080
}
EOF

docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile
```

Only on `Valid configuration`:

```bash
docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
curl -I https://64theatre.169-58-127-122.sslip.io
```

No DNS work needed — `sslip.io` already resolves that name to `169.58.127.122`.

The admin login comes from the demo seeder; `ADMIN-GUIDE.md` in the app repo has
the credentials and the walkthrough to hand the client.

---

## When the domain arrives

Three changes, then reload:

1. Point the domain's `A` record at `169.58.127.122`.
2. In `/srv/64theatre/.env`, set `APP_URL=https://<the-domain>`.
3. In `/srv/edge/sites/64theatre.caddy`, replace the sslip.io hostname.

```bash
docker compose -f /srv/64theatre/compose.yml up -d
docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile \
  && docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
```

> **Do this before selling real tickets.** Ticket QR codes are generated from
> `APP_URL`, so tickets issued under the sslip.io name would point at the old
> hostname. Fine while it's a demo; not fine once money is involved.

## Admin patches

Applied in order, against a clean checkout of `simboni/64theatre-platform`:

```bash
cd /srv/64theatre/repo
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0001-event-centred-admin.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0002-venue-create-inline.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0003-kopokopo-and-offline-payment.patch
cd /srv/64theatre && docker compose up -d --build
```

| Patch | What it does |
|---|---|
| `0001-event-centred-admin` | One-step event creation: a three-step wizard that takes performances and ticket prices with the event, performance names instead of row ids, and ticket categories edited from inside the performance |
| `0002-venue-create-inline` | Add and correct venues from the venue dropdown itself |
| `0003-kopokopo-and-offline-payment` | M-Pesa via Kopo Kopo, so tickets sell before the Safaricom paybill exists; plus Pay Bill details for buyers whose prompt never arrives |

`0002` fixes a **go-live blocker**, not a convenience. Venues are created only
inside `demoSeason()` in `database/seeders/DatabaseSeeder.php`, which runs
under `local` and `staging` and *not* under `production` — and no admin screen
creates one. Switching to `APP_ENV=production` (the first line of the section
below) therefore leaves zero venues and no way to add any; since a performance
requires a venue, no event can be created at all. Verified by migrating and
seeding a fresh database with `APP_ENV=production`: **0 venues**.

The staging box hides this completely, because the demo season has already
planted three.

## Taking money before the Safaricom paybill exists

`0003` adds Kopo Kopo, an M-Pesa aggregator. It sells through Kopo Kopo's own
till and settles to the client's account, so tickets can go on sale now rather
than after Safaricom approves a paybill in 64 Theatre's name — which takes
weeks. Switch `PAYMENT_GATEWAY=daraja` when it lands; nothing else in the
application changes, which is what the `PaymentGateway` interface is for.

```env
PAYMENT_GATEWAY=kopokopo
KOPOKOPO_BASE_URL=https://api.kopokopo.com   # sandbox.kopokopo.com while testing
KOPOKOPO_CLIENT_ID=...
KOPOKOPO_CLIENT_SECRET=...
KOPOKOPO_API_KEY=...                         # signs webhooks — NOT the client secret
KOPOKOPO_TILL_NUMBER=...
```

Set the webhook in the Kopo Kopo dashboard to `https://<host>/webhooks/kopokopo`.
It is verified by HMAC-SHA256 over the raw body using `KOPOKOPO_API_KEY`; an
unsigned or forged request gets a 401 and is never acted on.

Three things that bite:

- Success from the STK call is **201 with the handle in the `Location`
  header**, not in the body.
- `KOPOKOPO_API_KEY` is a **different secret** from the client secret. Swapping
  them authenticates fine and then fails every single callback.
- Live keys against the sandbox URL fail authentication, and the error does not
  say why.

Payments are stored with `gateway = 'aggregator'`, the value Pesapal already
uses, because that column is an enum and adding a value would mean an enum
migration — which on SQLite rebuilds the table holding live payment records.
The provider is recorded in `gateway_payload.provider`.

### Paying by hand

The STK prompt does not always arrive. The order page now also shows:

```
Pay Bill  →  Business number 542542 (I&M Bank)
             Account number  064064
```

Change them with `OFFLINE_PAYMENT_PAYBILL` / `_ACCOUNT` / `_BANK`, or hide the
panel with `OFFLINE_PAYMENT_ENABLED=false`.

**This is not reconciled automatically**, and the page says so to the buyer.
The account number identifies 64 Theatre to Kopo Kopo — it is not per-order, so
there is nowhere to put a reference. The buyer is told to keep the M-Pesa
confirmation SMS and quote their order number at the box office. Budget for
someone matching those by hand, or keep the panel off until you have a process
for it.

## Upgrading to production

Apply `0002` **before** this section, or the first thing a production install
does is refuse to create an event.

The demo config is deliberately not the live config. For real ticket sales the
repo's `DEPLOY.md` calls for:

- `APP_ENV=production`, a **fresh** `APP_KEY`, `SEED_ON_BOOT=false`
- `PAYMENT_GATEWAY=daraja` with production `DARAJA_*` credentials
- **PostgreSQL** instead of SQLite (`DB_CONNECTION=pgsql` + a `db` service)
- **Redis** + `QUEUE_CONNECTION=redis` and a **worker container**
  (`php artisan queue:work`)
- Real `MAIL_*` and `SMS_ENABLED=true` for ticket delivery
- Nightly database backups

Ask me when you reach that point and I'll extend this compose file — it's an
additive change, and the SQLite data can be migrated across.

## Safety

- No host ports. `edge-caddy` keeps 80/443.
- Its own compose project, volume and image — it cannot touch smpcredits,
  riziki, fitgen, cosdep, talithakum, stackup or the portfolio.
- `mem_limit: 512m`, so a runaway process can't starve the box.
- Always use `-f /srv/64theatre/compose.yml` so a command can never act on
  another project.

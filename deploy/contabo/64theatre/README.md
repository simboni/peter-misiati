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

Build first (the image is needed to generate a key):

```bash
docker compose -f /srv/64theatre/compose.yml build
```

Then put a real `APP_KEY` into `.env`:

```bash
KEY=$(docker run --rm 64theatre:local php artisan key:generate --show)
sed -i "s|^APP_KEY=.*|APP_KEY=${KEY}|" /srv/64theatre/.env
grep -c '^APP_KEY=base64:' /srv/64theatre/.env    # must print 1
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

## Upgrading to production

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

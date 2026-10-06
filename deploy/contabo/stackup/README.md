# Moving StackUp to the Contabo box

Today StackUp is spread across three hosts:

```
  Web  →  GitHub Pages        (static export)
  API  →  Fly.io              (stackup-api, 512 MB, iad)
  DB   →  Neon                (managed PostgreSQL 16)
```

After this it is two containers on your own server, with the API serving the
web app from the same origin:

```
  edge-caddy ──► stackup-api:3000 ──► stackup-db:5432   (private network)
      (TLS)        API + web app          your data
```

Expected cost on the box: **~400 MB RAM idle**, capped at 1.75 GB. You have
9.6 GB available, so this is comfortable.

> **The database move is the only risky step.** Everything else is additive and
> reversible. Do the dump/restore with StackUp idle, and keep Neon alive until
> you've confirmed the new copy works — it is your rollback.

---

## 1 · Set it up (no traffic yet)

```bash
mkdir -p /srv/stackup
git clone --depth 1 https://github.com/simboni/smp-planning /srv/stackup/repo

cp /srv/smp-portfolio/repo/deploy/contabo/stackup/{compose.yml,init-db.sh,.env.example} /srv/stackup/
cd /srv/stackup
cp .env.example .env && chmod 600 .env
```

Fill in `.env` — four secrets. Generate each one:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # passwords
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_SECRET
```

Then build and start. The first build takes a few minutes (pnpm install +
three builds):

```bash
docker compose up -d --build
docker compose logs -f api        # ctrl-C when it reports listening
```

Check nothing else moved:

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
```

## 2 · Create the schema

The two roles and the `stackup` database are created automatically on the
volume's first start. Now run the migrations as the **migrator** role:

```bash
cd /srv/stackup
source .env
docker compose exec \
  -e ADMIN_DB_URL="postgres://stackup_migrator:${STACKUP_MIGRATOR_PASSWORD}@db:5432/stackup" \
  api sh -c 'cd /app && ./node_modules/.bin/tsx db/migrate.ts'
```

Expect each `0001_core.sql` … migration to report applied. Re-running is safe —
the runner records applied files in `schema_migrations`.

## 3 · Move the data from Neon

**Do this with nobody using StackUp.** Get the Neon **owner** connection string
from the Neon console (or `fly secrets list` / your notes on Fly).

```bash
# a) dump Neon  (run on the server; needs postgresql-client)
apt-get update && apt-get install -y postgresql-client

NEON='postgresql://neondb_owner:PW@ep-xxx.aws.neon.tech/neondb?sslmode=require'
pg_dump --no-owner --no-privileges --format=custom -d "$NEON" -f /root/stackup-neon.dump
ls -lh /root/stackup-neon.dump
```

`--no-owner --no-privileges` matters: Neon's owner role doesn't exist here, and
the migrations have already created the correct ownership and grants.

```bash
# b) restore into the container, as the migrator (schema owner)
source /srv/stackup/.env
docker cp /root/stackup-neon.dump stackup-db:/tmp/stackup.dump
docker compose -f /srv/stackup/compose.yml exec db \
  pg_restore --no-owner --no-privileges --data-only --disable-triggers \
    -U stackup_migrator -d stackup /tmp/stackup.dump
```

`--data-only` because step 2 already built the schema. `--disable-triggers`
lets rows load regardless of insertion order.

```bash
# c) sanity check
docker compose -f /srv/stackup/compose.yml exec db \
  psql -U stackup_migrator -d stackup -c \
  "select (select count(*) from workspaces) as workspaces,
          (select count(*) from users) as users,
          (select count(*) from tasks) as tasks;"
```

Compare those counts against Neon. If they don't match, stop — don't cut DNS.

Restart the API so it picks up a warm connection pool:

```bash
docker compose -f /srv/stackup/compose.yml restart api
```

## 4 · Verify before publishing

```bash
docker exec edge-caddy wget -qO- http://stackup-api:3000/ | head -20
```

That should print the web app's HTML. If it does, the whole path works.

## 5 · Publish

```bash
cat > /srv/edge/sites/stackup.caddy <<'EOF'
# stackup.co.ke — StackUp (API + web served by one container)

www.stackup.co.ke {
	redir https://stackup.co.ke{uri} permanent
}

stackup.co.ke {
	reverse_proxy stackup-api:3000 {
		# Server-Sent Events: never buffer, never time out the stream.
		flush_interval -1
	}
}
EOF

docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile
```

`flush_interval -1` is **not optional** — StackUp's realtime bus is SSE, and a
buffering proxy breaks live updates and presence.

Only when validate passes:

```bash
docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
```

## 6 · DNS

Point the domain at the box **before** the reload so the certificate issues on
the first try.

```bash
dig +short NS stackup.co.ke      # find the managing panel
```

| Host | Type | Value |
|---|---|---|
| `@` | A | `169.58.127.122` |
| `www` | A | `169.58.127.122` |

Delete every other `A`/`AAAA`/`CNAME` on those names — leftovers from a
previous host are what made smp-developers.com flap.

```bash
dig +short A stackup.co.ke            # only 169.58.127.122
curl -I https://stackup.co.ke
```

## 7 · Back it up — before you retire anything

This is now real data on a box with **no provider backups**. Nightly dump,
14-day retention:

```bash
mkdir -p /srv/stackup/backups
cat > /usr/local/bin/stackup-backup.sh <<'EOF'
#!/bin/sh
set -e
OUT=/srv/stackup/backups/stackup-$(date -u +%Y%m%d-%H%M).dump
docker exec stackup-db pg_dump -U stackup_migrator -Fc stackup > "$OUT"
find /srv/stackup/backups -name 'stackup-*.dump' -mtime +14 -delete
EOF
chmod +x /usr/local/bin/stackup-backup.sh

# crontab -e
0 2 * * * /usr/local/bin/stackup-backup.sh
```

Test a restore at least once before trusting it. A backup you have never
restored is a hope, not a backup.

## 8 · Retire the old hosts

Only after a few days of the new deployment behaving:

- **Fly.io** — `fly apps destroy stackup-api` (stops the bill).
- **Neon** — keep it a while longer as a cold rollback, then delete the project.
- **GitHub Pages** — the web is now served by the API; disable the Pages
  workflow so it can't claim the domain.

---

## Updating later

```bash
cd /srv/stackup/repo && git pull
cd /srv/stackup && docker compose up -d --build
docker compose exec -e ADMIN_DB_URL="postgres://stackup_migrator:$STACKUP_MIGRATOR_PASSWORD@db:5432/stackup" \
  api sh -c 'cd /app && ./node_modules/.bin/tsx db/migrate.ts'
```

Rebuild, restart, migrate. Nothing else on the server is touched.

## Rolling back

The old stack stays intact until step 8, so rollback is a DNS change back to
Fly plus `docker compose stop` here. Keep Neon until you are sure.

## Notes

- **Never publish the database port.** `db` is on the private `internal`
  network only. If you need psql, use `docker compose exec db psql`.
- **Never grant `stackup_app` BYPASSRLS.** That role being NOBYPASSRLS *is*
  the tenant-isolation model.
- `JWT_SECRET` must stay stable — changing it logs everyone out.

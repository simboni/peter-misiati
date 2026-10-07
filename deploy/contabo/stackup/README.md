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

cp /srv/smp-portfolio/repo/deploy/contabo/stackup/{compose.yml,init-db.sh,env.example} /srv/stackup/
cd /srv/stackup
cp env.example .env && chmod 600 .env
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
# The API and the database.
docker exec edge-caddy wget -qO- http://stackup-api:3000/health
# → {"status":"ok","db":true}

# The web app. The Accept header is REQUIRED, not decoration — see below.
docker exec edge-caddy wget -qO- --header='Accept: text/html' \
  http://stackup-api:3000/ | head -20
```

The first prints JSON; `"db":true` means the API reached PostgreSQL. The
second prints the web app's HTML. If both do, the whole path works.

> **Why the Accept header.** The API serves the exported HTML only to requests
> that ask for `text/html` (or to a link-preview crawler). That is deliberate:
> the web page routes and the API routes share names — `/teams` the page and
> `/teams` the API — so an extensionless `.html` fallback would shadow every
> API route. Browsers send `Accept: text/html`; `wget`, `curl` and Node's
> `fetch` send `*/*` and get a 404 from the router instead.
>
> Without the header this step prints nothing, which reads exactly like a
> failed deployment. It isn't. The same mistake in `compose.yml`'s healthcheck
> is what reported `stackup-api` unhealthy for a day while it was serving
> correctly — `docker ps` said `(unhealthy)`, a browser would have said fine.
> If the container shows unhealthy, run the two commands above before
> assuming anything is actually broken.

## 5 · DNS — before publishing, not after

Caddy asks Let's Encrypt for a certificate on the **first request** for a
hostname, and failed validations are rate-limited. So wrong DNS at reload time
does not merely fail; it spends attempts you then have to wait out. This step
comes first for that reason.

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
```

## 6 · Publish

```bash
cd /srv/smp-portfolio/repo && git pull
bash deploy/contabo/stackup/publish.sh
```

It creates exactly one file, `/srv/edge/sites/stackup.caddy`, and reloads
Caddy. It never edits another site's file, never touches `/srv/edge/Caddyfile`,
and never restarts `edge-caddy` — a restart drops every site on the box at
once, where a reload is a graceful config swap that drops no connections.

Before it writes anything it refuses to continue unless the API answers
`/health` with `db:true`, the web export really serves HTML, `stackup.co.ke`
resolves to this box, and the database has users in it — an empty StackUp
served publicly is worse than one that is briefly unreachable, and Neon is
still the rollback. Pass `--allow-empty` if publishing empty is deliberate.

Afterwards it checks two things that are easy to get wrong:

- **Is the file actually in force?** If `/srv/edge/Caddyfile` imports site
  files one by one rather than globbing `sites/`, a new file is inert — and
  every step before this would still have reported success.
- **Did anything else move?** It probes every hostname Caddy was serving
  before and after. If one that answered has stopped, it removes the file,
  reloads, and tells you, without asking.

`bash publish.sh --unpublish` reverses it.

> The hostname list comes from `caddy adapt`, not from grepping the Caddyfile.
> On this box `/srv/edge/Caddyfile` contains only `import` lines, so grepping
> it finds zero hostnames, and a before/after check built that way passes
> vacuously while looking rigorous. That is how riziki-pos turned out to be
> unprotected by an earlier version of this safety net.

```bash
curl -sI https://stackup.co.ke | head -3
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

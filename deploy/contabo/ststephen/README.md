# St Stephen's Brothers' School, Kimaeti — EMS

Source: **github.com/simboni/st-stephen-kimaeti**

## Read this first

An earlier deployment of this school was built from `simboni/hollycrossbulimbo`
and is months behind. It has a different logo, a different theme, and is
**missing the boarding and transport modules entirely** — seven Prisma models
(`Hostel`, `HostelRoom`, `BedAllocation`, `TransportRoute`, `RouteStage`,
`Vehicle`, `TransportAssignment`) and two migrations.

That deployment runs as compose project **`stephens`**. This one is
**`ststephen`**, so both can run side by side while the new one is checked, and
the old one is removed only once this is serving. Nothing else on the box is
touched either way.

With 157 boarders — 30% of the roll — the boarding module is not optional here,
which is the single clearest reason the old build cannot be what the school
tests on.

## Deploy

```bash
# 1. Prove the names are free. Read-only; changes nothing.
bash /srv/smp-portfolio/repo/deploy/contabo/preflight.sh ststephen

# 2. Snapshot, so you can prove nothing else moved.
docker ps --format '{{.Names}}\t{{.Status}}' > /root/before-ststephen.txt

# 3. Set it up in its own directory.
mkdir -p /srv/ststephen
git clone --depth 1 https://github.com/simboni/st-stephen-kimaeti /srv/ststephen/repo
cd /srv/smp-portfolio/repo && git pull
cp deploy/contabo/ststephen/compose.yml deploy/contabo/ststephen/env.example /srv/ststephen/

# 4. Secrets.
cd /srv/ststephen
cp env.example .env && chmod 600 .env
{
  echo "DB_PASSWORD=$(openssl rand -hex 24)"
  echo "AUTH_SECRET=$(openssl rand -hex 32)"
  echo "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)"
  echo "ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
} >> .env
grep '^ADMIN_PASSWORD=' .env     # write this down

# 5. Build and start. Still private — nothing serves it yet.
docker compose up -d --build
docker compose logs -f ems       # wait for migrations, then the ready line
```

> **Check `free -m` before building.** This box has no swap and a Next.js build
> is the heaviest thing that happens on it. Under ~1.5 GB available, wait.

```bash
# 6. Prove it answers, before touching anything shared.
docker exec edge-caddy wget -qO- http://ststephen-ems:3000/api/health
```

## Switch over

The new site file keeps the **same hostname** the old deployment used, so no
DNS changes and no new certificate — the switch is invisible from outside.

```bash
cp /srv/smp-portfolio/repo/deploy/contabo/ststephen/ststephen.caddy \
   /srv/edge/sites/stephens.caddy
docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile \
  && docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
curl -sI https://stephens.169-58-127-122.sslip.io/ | head -3
```

Validate before reload, and reload rather than restart — restarting edge-caddy
drops every site on the box at once.

## Retire the old one

Only once the new EMS is confirmed working in a browser.

```bash
# Keep a dump of the old database first — cheap, and it is the only copy.
docker exec stephens-db pg_dump -U stephens -Fc stephens \
  > /root/stephens-old-$(date -u +%F).dump

docker compose -f /srv/stephens/compose.yml down   # volume survives
```

`down` without `-v` leaves `stephens_db-data` in place, so this is reversible.
Remove the volume only when you are certain:

```bash
docker volume rm stephens_db-data        # irreversible
```

## After the first sign-in

1. **Change the superadmin password** under Users, then blank the line:
   `sed -i 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=/' /srv/ststephen/.env`
2. **Back it up.** Nothing on this box backs up automatically:
   ```bash
   mkdir -p /var/backups
   docker exec ststephen-db pg_dump -U ststephen -Fc ststephen \
     > /var/backups/ststephen_$(date -u +%F_%H%M).dump
   ```
   That lands on the same disk as the data, so it protects against mistakes and
   nothing else. Pull it off the box.

## Updating later

```bash
cd /srv/ststephen/repo && git pull
cd /srv/ststephen && docker compose up -d --build
```

Migrations run on boot; `migrate deploy` only applies files that have not run,
and never drops or rewrites data.

## The public website

`apps/website` in that repo is St Stephen's own site and is **not** deployed
here — the EMS is what the school is testing. Serving it is a second container
and a second hostname; ask when the school wants it.

## Never run these

```bash
docker compose down -v               # destroys the school's records
docker system prune -a --volumes     # destroys every client database
docker restart edge-caddy            # drops every site; use `caddy reload`
```

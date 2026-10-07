# St Stephen's Brothers' School, Kimaeti — where its deployment lives

**Not here.** The deployment kit for this school is in the school's own
repository, and that is the only one to use:

    github.com/simboni/st-stephen-kimaeti  →  deploy/edge/

```bash
cd /srv/ststephen/repo && git pull
less deploy/edge/README.md
```

## Live now

| What | URL | Container |
| --- | --- | --- |
| EMS | https://ems.169-58-127-122.sslip.io | `ststephen-ems` |
| School website | https://school.169-58-127-122.sslip.io | `ststephen-web` |

Compose project `ststephen`, in `/srv/ststephen`. Confirmed serving 7 October
2026, running the current code — the health endpoint reports 45 permissions,
where the older build reported 39; the extra rows are the boarding and
transport modules.

## Why this directory is empty

It briefly held a second, parallel kit I wrote for this box: its own
`compose.yml`, `env.example` and a site file that published
`stephens.169-58-127-122.sslip.io`. The school's repo already had
`deploy/edge/`, written for this same server, using **different hostnames**.
Two kits, and the one in this repo pointed at a hostname nothing served — so
the instructions here sent anyone following them to a page that could never
load. The files are gone rather than fixed, because a deployment kit that
disagrees with the real one is worse than no kit at all.

One thing to check on the box, left over from that: a site file at
`/srv/edge/sites/stephens.caddy`. The real kit writes `ststephen.caddy`, so
`stephens.caddy` belongs to the superseded deployment and publishes a hostname
no longer wanted. Removing it is safe once the two URLs above are confirmed,
but prove it rather than trusting it:

```bash
ls /srv/edge/sites/
mv /srv/edge/sites/stephens.caddy /root/stephens.caddy.retired
docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile \
  && docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
for h in ems school; do
  printf '%-8s %s\n' "$h" "$(curl -so /dev/null -w '%{http_code}' https://$h.169-58-127-122.sslip.io/)"
done
```

Validate before reload, and reload rather than restart — restarting
`edge-caddy` drops every site on the box at once. If either URL stops
answering, `mv` the file back and reload again.

## Still outstanding

1. **Change the superadmin password** in the EMS under Users, then blank the
   line that seeded it, so the live password is not sitting in a file:
   ```bash
   sed -i 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=/' /srv/ststephen/.env
   ```
   No restart needed — it is read only when the admin user is first created.
2. **Take a database backup.** Nothing on this box backs up automatically:
   ```bash
   mkdir -p /var/backups
   docker exec ststephen-db pg_dump -U ststephen -Fc ststephen \
     > /var/backups/ststephen_$(date -u +%F_%H%M).dump
   ```
   That lands on the same disk as the data, so it protects against mistakes
   and nothing else. Pull a copy off the box.
3. **Retire the old `stephens` stack**, which is still running and still
   holding memory. Keep a dump first; it is the only copy:
   ```bash
   docker exec stephens-db pg_dump -U stephens -Fc stephens \
     > /root/stephens-old-$(date -u +%F).dump
   docker compose -f /srv/stephens/compose.yml down
   ```
   `down` without `-v` leaves `stephens_db-data` in place, so this is
   reversible. Remove the volume only when certain: `docker volume rm
   stephens_db-data` is irreversible.

## Never run these

```bash
docker compose down -v               # destroys the school's records
docker system prune -a --volumes     # destroys every client database
docker restart edge-caddy            # drops every site; use `caddy reload`
```

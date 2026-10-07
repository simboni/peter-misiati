# Adding an app to this server without touching the others

Seven things already run on this box — `edge-caddy`, smpcredits (prod and
staging), riziki-pos, fitgen, cosdep, talithakum, stackup, the portfolio and
64theatre. None of them has been restarted or reconfigured by any of the
additions. That is not luck; it comes from five rules.

## The five rules

1. **Never bind a host port.** `edge-caddy` owns 80 and 443 and terminates TLS
   for everything. A new app `expose`s its port to the `edge` network only.
2. **Own everything you create.** Your own compose project name, container
   name, volumes, private network and directory under `/srv/<app>`. Reusing an
   existing name can adopt — or destroy — another project's containers.
3. **Join `edge`, never modify it.** `networks: edge: external: true`. Joining
   reads it; it does not change it.
4. **Add a file, never edit one.** Publishing means a *new*
   `/srv/edge/sites/<app>.caddy`. Never touch `/srv/edge/Caddyfile` (it just
   `import`s that directory) or another app's site file.
5. **Always `caddy validate` then `caddy reload`.** Validate first: a bad file
   applies nothing. Reload is a graceful config swap — **never `restart`
   edge-caddy**, that drops every site at once.

Plus: set `mem_limit` on every service, so one runaway app cannot starve the
box.

## The sequence

```bash
# 0. Prove the names are free — read-only, changes nothing.
bash /srv/smp-portfolio/repo/deploy/contabo/preflight.sh <app> [hostname]

# 1. Snapshot, so you can prove nothing else moved.
docker ps --format '{{.Names}}\t{{.Status}}' > /root/before-<app>.txt

# 2. Set it up in its own directory.
mkdir -p /srv/<app>
git clone --depth 1 <repo> /srv/<app>/repo
#    copy the closest template from deploy/contabo/ (see below)

# 3. Start it — still private, nothing is serving it yet.
docker compose -f /srv/<app>/compose.yml up -d --build

# 4. Prove it works BEFORE touching anything shared.
docker exec edge-caddy wget -qO- http://<app>:<port>/ | head -20

# 5. Publish: a NEW site file, validate, reload.
cat > /srv/edge/sites/<app>.caddy <<'EOF'
<hostname> {
	reverse_proxy <app>:<port>
}
EOF
docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile \
  && docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile

# 6. Prove nothing else moved.
diff <(docker ps --format '{{.Names}}\t{{.Status}}' | grep -v <app>) \
     <(grep -v <app> /root/before-<app>.txt)
```

Step 6 printing nothing is the whole guarantee: every other container still
counting from its original start time.

## Pick a template

| The app is… | Start from | Shape |
|---|---|---|
| Plain HTML/CSS/JS | `static-site/` | one caddy container, ~30 MB |
| A static-export SPA | `static-site/` | same; build first, serve `out/` |
| Node/Next.js, no database | `../compose.yml` (portfolio) | one container |
| Node + PostgreSQL | `stackup/` | app + db on a private network |
| PHP/Laravel | `64theatre/` | serversideup image, SQLite or Postgres |

Copy the closest one, rename, adjust. Don't start from scratch.

## No domain yet?

Free wildcard DNS gives real HTTPS with no registrar:

```
<app>.169-58-127-122.sslip.io
```

Already resolves to this box; Caddy issues a genuine Let's Encrypt
certificate. Swap in the real hostname later — one line, then reload.

> If the app generates links or QR codes from its own base URL, set that URL
> to the final domain **before** anything is issued to a customer.

## If something looks wrong

```bash
docker compose -f /srv/<app>/compose.yml down
```

Removes only that app's containers and network. Its volume survives, and
nothing else is affected.

## Never run these

```bash
docker compose down            # in a directory you did not create
docker system prune -a --volumes   # deletes client databases
docker volume rm <anything>
docker network rm edge         # every site depends on it
docker restart edge-caddy      # use `caddy reload` instead
```

`docker builder prune -f` is the safe cleanup — build cache only. It freed
27 GB last time without touching an image, container or volume.

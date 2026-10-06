# Adding another static site to the Contabo box

The pattern, once: a tiny `caddy:2-alpine` container serves the site's files on
port 80 **inside** the `edge` network, and `edge-caddy` proxies to it by
container name. No host ports are bound, no existing file is edited, nothing
else restarts. Each site costs roughly **30 MB of RAM**.

---

## Worked example — commrdrdenniswamalwa.co.ke

The site is plain HTML with no build step, so "deploying" is just cloning it.

### 1. Set it up (on the server)

```bash
mkdir -p /srv/wamalwa
git clone --depth 1 https://github.com/simboni/commissioner-wamalwa /srv/wamalwa/repo

# the reusable template
cp /srv/smp-portfolio/repo/deploy/contabo/static-site/compose.yml  /srv/wamalwa/
cp /srv/smp-portfolio/repo/deploy/contabo/static-site/Caddyfile    /srv/wamalwa/

cat > /srv/wamalwa/.env <<'EOF'
SITE_NAME=wamalwa
SITE_ROOT=./repo
EOF

cd /srv/wamalwa && docker compose up -d
```

Check it serves, before touching anything shared:

```bash
docker exec edge-caddy wget -qO- http://wamalwa-web/ | head -20
```

That should print the site's HTML. If it does, the plumbing is proven.

### 2. Publish it

```bash
cat > /srv/edge/sites/wamalwa.caddy <<'EOF'
# commrdrdenniswamalwa.co.ke — Dr. Dennis Wamalwa (static site)

commrdrdenniswamalwa.co.ke {
	redir https://www.commrdrdenniswamalwa.co.ke{uri} permanent
}

www.commrdrdenniswamalwa.co.ke {
	reverse_proxy wamalwa-web:80
}
EOF

docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile
```

Only when that says `Valid configuration`:

```bash
docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
```

> **Canonical host:** the block above treats **www** as canonical, matching the
> site's current public URL, and redirects the apex to it. The repo's `CNAME`
> file names the apex instead — if you'd rather the apex win, swap the two
> hostnames in that file and reload.

### 3. DNS

Point the domain at the box **before** reloading, so the certificate is issued
on the first attempt instead of failing against Let's Encrypt's rate limits.

```bash
dig +short NS commrdrdenniswamalwa.co.ke     # find which panel manages it
```

Then, at that provider:

| Host | Type | Value |
|---|---|---|
| `@` | A | `169.58.127.122` |
| `www` | A | `169.58.127.122` |

Delete any other `A`/`AAAA`/`CNAME` on those two names — leftovers from the old
host are exactly what caused smp-developers.com to go up and down at random.

Confirm, then reload:

```bash
dig +short A www.commrdrdenniswamalwa.co.ke   # only 169.58.127.122
curl -I https://www.commrdrdenniswamalwa.co.ke
```

### 4. Retire the old host
Once it serves from Contabo, delete the service on **Render** so nothing
competes for the domain.

### Updating later

```bash
cd /srv/wamalwa/repo && git pull
```

Caddy serves the new files immediately — no restart needed.

---

## For the next static site

Same five steps with the names changed:

```bash
mkdir -p /srv/<name>
git clone --depth 1 <repo-url> /srv/<name>/repo
cp /srv/smp-portfolio/repo/deploy/contabo/static-site/{compose.yml,Caddyfile} /srv/<name>/
printf 'SITE_NAME=<name>\nSITE_ROOT=./repo\n' > /srv/<name>/.env
cd /srv/<name> && docker compose up -d
```

Then a `<name>.caddy` file in `/srv/edge/sites/`, validate, reload.

Edit the copied `Caddyfile` if that site needs different redirects — the one in
this template carries Wamalwa's `/news.html → /blog.html` rule, which other
sites won't want.

## Rules that keep the other apps safe

- Never add `ports:` to these compose files — `edge-caddy` owns 80/443.
- Never edit `/srv/edge/Caddyfile` or another site's `.caddy` file; add your own.
- Always `caddy validate` before `caddy reload`; never `restart` edge-caddy.
- Keep `mem_limit` set, so one misbehaving site cannot starve the box.

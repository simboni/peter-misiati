# Moving smp-developers.com to the Contabo VPS

Your portfolio is a **Next.js static export** — plain HTML, CSS, JS and images.
There is no Node process to run, no database, no container required. That makes
this migration unusually safe: it is a folder of files plus **one** block of
reverse-proxy config.

> **The one real risk:** your Riziki stack already runs its own Caddy that owns
> ports **80 and 443**. Anything new that tries to bind those ports will fight it
> and take Riziki down. Everything below is designed to avoid that.

---

## The rules this kit follows

1. **Never bind 80/443.** The proxy that already owns them keeps owning them.
2. **Never restart another app.** We add a site to the running proxy and
   *reload* it — Caddy and nginx both reload without dropping connections.
3. **Everything this site owns lives under `/srv/smp-portfolio`.** Nothing else
   on the box is written to.
4. **Atomic releases.** Each deploy is a new timestamped folder; a symlink flip
   makes it live. Rollback is another flip.

---

## Step 1 — Audit the server (read-only, changes nothing)

```bash
scp docs/deploy/discover.sh YOUR_SERVER:/tmp/
ssh YOUR_SERVER 'bash /tmp/discover.sh'
```

It reports what owns 80/443, which containers run, where the Caddyfile(s) live,
which domains are already served, free disk/RAM, and the public IP. **Send me
that output** and I'll give you the exact config block for your setup.

What you're looking for in the result:

| What it shows | What it means |
|---|---|
| Caddy (container or host) on 80/443 | Best case — add one site block, reload |
| nginx on 80/443 | Also fine — add one `conf.d` file, reload |
| Nothing on 80/443 | Install Caddy fresh, it's the simplest |

---

## Step 2 — First deploy (files only — still serves nothing)

From your laptop, in the repo:

```bash
SERVER=root@YOUR_SERVER_IP bash docs/deploy/deploy.sh
```

This builds `out/`, uploads it to `/srv/smp-portfolio/releases/<timestamp>/`,
and points `/srv/smp-portfolio/current` at it. Nothing is serving it yet, so
this is completely safe to run before the proxy is configured.

Every later deploy is the same single command.

---

## Step 3 — Add ONE site block to the proxy that already exists

### Case A — Caddy (most likely, since Riziki uses it)

Find the Caddyfile (`discover.sh` prints its path). **Back it up first:**

```bash
cp /path/to/Caddyfile /path/to/Caddyfile.bak.$(date +%F)
```

Append this — do not change anything already in the file:

```caddy
www.smp-developers.com {
    redir https://smp-developers.com{uri} permanent
}

smp-developers.com {
    root * /srv/smp-portfolio/current
    encode zstd gzip
    try_files {path} {path}/ {path}/index.html /404.html
    file_server
    header /_next/static/* Cache-Control "public, max-age=31536000, immutable"
}
```

Validate, then reload (reload ≠ restart — Riziki keeps serving):

```bash
# host install:
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy

# Caddy running as a container (replace caddy with its real name):
docker exec caddy caddy validate --config /etc/caddy/Caddyfile \
  && docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

**If Caddy is a container**, it can only serve files it can see. Its compose
service needs the release directory mounted read-only:

```yaml
    volumes:
      - /srv/smp-portfolio:/srv/smp-portfolio:ro   # add this line only
```

Adding a volume does require recreating that one container
(`docker compose up -d caddy`) — a sub-second gap for Riziki, not an outage.
Do it once, at a quiet hour.

### Case B — nginx already owns 80/443

Create a **new** file — never edit `nginx.conf`:

```bash
sudo tee /etc/nginx/conf.d/smp-developers.conf >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name smp-developers.com www.smp-developers.com;
    root /srv/smp-portfolio/current;

    location / { try_files $uri $uri/ $uri/index.html /404.html; }
    location /_next/static/ { expires 1y; add_header Cache-Control "public, immutable"; }
    gzip on; gzip_types text/css application/javascript image/svg+xml;
}
EOF
sudo nginx -t && sudo systemctl reload nginx
```

Then issue the certificate (certbot edits only this server block):

```bash
sudo certbot --nginx -d smp-developers.com -d www.smp-developers.com
```

### Case C — nothing on 80/443 yet

Install Caddy on the host and use the Case A block as the whole Caddyfile.
Caddy obtains and renews HTTPS certificates automatically.

---

## Step 4 — DNS cutover (this is where your outages came from)

Your apex currently resolves to **three** places — one Vercel address and a
stale **Hostinger** pair. That is why the site is up or down at random. Fix it
in the same pass:

At your DNS provider, for `smp-developers.com`:

| Action | Record |
|---|---|
| **Delete** | `A  82.29.191.136` (Hostinger) |
| **Delete** | `AAAA 2a02:4780:a:2173:0:2f78:e5b3:2` (Hostinger) |
| **Delete** | `A  216.198.79.1` (Vercel) |
| **Add** | `A  <your Contabo IPv4>` |
| **Update** | `www` → `A <your Contabo IPv4>` (remove its Vercel records) |

There must be **exactly one** A record for the apex. Lower the TTL to 300
seconds a few hours beforehand so the switch is quick.

Verify afterwards:

```bash
dig +short A smp-developers.com      # one IP: your Contabo box
curl -I https://smp-developers.com   # 200, and `server:` should say Caddy/nginx
```

---

## Step 5 — Turn off the hosts you're leaving

Only once the Contabo copy is confirmed serving:

- **Vercel** → Settings → Domains → remove `smp-developers.com`. Keep the
  project; `peter-misiati.vercel.app` stays as a free standby.
- **GitHub Pages** → repo Settings → Pages → set Source to **None**. Pages is
  currently enabled (`has_pages: true`) with no workflow building it; leaving it
  on means a third party can claim the domain later.

---

## Routine updates after this

```bash
SERVER=root@YOUR_SERVER_IP bash docs/deploy/deploy.sh
```

Build, upload, flip. Takes seconds. The proxy is never touched again.

**Rollback**, if a deploy ever looks wrong:

```bash
SERVER=root@YOUR_SERVER_IP bash docs/deploy/deploy.sh --rollback
```

---

## Things to refuse to do on this server

- `docker compose down` in a directory you did not create — it stops Riziki.
- Editing `nginx.conf` or an existing Caddyfile site block in place.
- Running a new container with `ports: ["80:80"]` or `["443:443"]`.
- `certbot --nginx` without `-d` flags (it will offer to touch other vhosts).
- Deleting anything under `/var/lib/docker` to free space.

If space ever runs short, `docker image prune` (images only, not volumes) is the
safe one.

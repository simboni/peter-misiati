# KeYSA on the Contabo box

Source: **github.com/simboni/keysa-website**
Compose project **`keysa`** · container `keysa-web` · domain `www.keysa.org`

Moving keysa.org off Netlify. The site is a Next.js static export with no
backend: nine routes, a `_next/` bundle, and forms that are all `mailto:` to
`info@keysa.org`. **Nothing on it stores data**, so the files are the whole
migration — no database, no form service, no API.

## Before anything else

**These are build outputs, not source.** The repository holds compiled HTML
and hashed JavaScript chunks. The site can be served exactly as it is, but
nobody can change a programme description or add a news post without the
original project. Finding that source is a separate and more important job
than this deployment; until it exists, this is a snapshot.

Say so to the client before they ask for an edit, not after.

## 1 · Set it up (nothing serving yet)

```bash
bash /srv/smp-portfolio/repo/deploy/contabo/preflight.sh keysa
docker ps --format '{{.Names}}\t{{.Status}}' > /root/before-keysa.txt

mkdir -p /srv/keysa
git clone --depth 1 https://github.com/simboni/keysa-website /srv/keysa/repo
cp /srv/smp-portfolio/repo/deploy/contabo/static-site/compose.yml /srv/keysa/
cp /srv/smp-portfolio/repo/deploy/contabo/keysa/Caddyfile /srv/keysa/
cp /srv/smp-portfolio/repo/deploy/contabo/keysa/env.example /srv/keysa/.env
```

Note the `Caddyfile` comes from **this** directory, not from `static-site/`.
The shared one carries another site's redirect and expects flat `.html` files;
this is a Next export where every route is a directory.

```bash
cd /srv/keysa && docker compose up -d
docker exec edge-caddy wget -qO- --header='Accept: text/html' http://keysa-web/ | head -5
```

That should print HTML. It costs nothing to send the Accept header and a
silent `/` probe is indistinguishable from a broken deploy.

Check a nested route resolves, since that is what the directory-style
`try_files` is for:

```bash
docker exec edge-caddy wget -qO- --header='Accept: text/html' http://keysa-web/about/ | head -3
docker exec edge-caddy wget -S -qO- http://keysa-web/nothing-here 2>&1 | head -3
```

The second should be a 404 serving the site's own 404 page, not Caddy's.

## 2 · DNS

`keysa.org` currently resolves to `2.57.91.91`, which is the Hostinger
shared host. Both names move here:

| Host | Type | Value |
|---|---|---|
| `@` | A | `169.58.127.122` |
| `www` | A | `169.58.127.122` |

Delete any other `A`/`AAAA`/`CNAME` on those names — `www` is currently a
CNAME to the apex, and that must go or it will fight the A record.

Do this **before** the reload: Caddy asks Let's Encrypt on first contact and
failed validations are rate-limited, so wrong DNS spends attempts rather than
merely failing. Confirm from the box before publishing:

```bash
dig +short A keysa.org www.keysa.org
```

## 3 · Publish

```bash
cp /srv/smp-portfolio/repo/deploy/contabo/keysa/keysa.caddy /srv/edge/sites/keysa.caddy
docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile \
  && docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
```

Validate before reload, and reload rather than restart — restarting
`edge-caddy` drops every site on the box at once.

Then confirm nothing else moved:

```bash
for h in smp-developers.com tickets.64theatre.art stackup.co.ke \
         fitgenerationsgym.com rizikichemicals.co.ke smpcredits.co.ke; do
  printf '%-34s %s\n' "$h" "$(curl -sSo /dev/null -m 15 -H 'Accept: text/html' -w '%{http_code}' https://$h/)"
done
curl -sI -H 'Accept: text/html' https://www.keysa.org | head -3
curl -sI https://keysa.org | head -3
```

The apex should answer `301` to `https://www.keysa.org`. **www is canonical
here**, the reverse of the other sites, because the build writes
`https://www.keysa.org` into its social metadata.

## 4 · Leave Netlify

Only once www.keysa.org serves from this box. Nothing in the site calls a
Netlify function or posts to Netlify Forms — the only trace is the `_headers`
file, whose rules are translated into this kit's `Caddyfile`. So deleting the
Netlify site breaks nothing.

Worth doing promptly rather than leaving it: the Netlify account was suspended
for non-payment on 28 September, and a suspended account is not a rollback.

The Hostinger plan behind `2.57.91.91` is a separate question — check what
else is on it before cancelling anything, since other domains may share it.

## Updating later

```bash
cd /srv/keysa/repo && git pull
```

No rebuild and no restart: the container serves the directory read-only, so
new files are live as soon as they land. That is the whole benefit of the site
being static — and the whole problem with it being build output, since a
"content change" means someone re-exporting the project from source.

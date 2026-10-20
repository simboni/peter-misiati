# Zuri Hotels & Resorts on the Contabo box

`zuriplaceresort.com` — a static site. Caddy serving a folder: no build, no
database, no PHP. The whole deploy is a `git clone`, and every update after it
is a `git pull`.

Repo: <https://github.com/simboni/zuriplace> · about **30 MB of RAM**.

---

## What is being deployed

Six pages — home, rooms, restaurant, Zuri Poa / Resort, Eden Safari Uganda,
contact — covering properties in Bungoma, Kanduyi, Makutano and Malaba. It was
built to move the business **off WordPress**: hand-written HTML, CSS and
vanilla JS with no dependencies, replacing a hacked WP install full of casino
spam. There is a four-step booking flow that hands off to WhatsApp or email,
so nothing here takes payments or stores a booking.

---

## 1. Put it on the box

```bash
mkdir -p /srv/zuriplace
git clone --depth 1 https://github.com/simboni/zuriplace /srv/zuriplace/repo

cd /srv/smp-portfolio/repo && git pull
cp deploy/contabo/zuriplace/compose.yml /srv/zuriplace/
cp deploy/contabo/zuriplace/Caddyfile   /srv/zuriplace/

cd /srv/zuriplace && docker compose up -d
```

Prove the plumbing **before** touching anything shared:

```bash
docker exec edge-caddy wget -qO- http://zuriplace-web/ | head -20
```

That should print the site's HTML. If it does, the container and the network
are both right and nothing public has been changed yet.

Confirm nothing else moved:

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
```

## 2. Point the domain at the box — BEFORE publishing

Do this first, or Caddy asks Let's Encrypt for a certificate it cannot prove
and burns attempts against the rate limit for the domain.

```bash
dig +short NS zuriplaceresort.com     # which panel manages it
dig +short A  zuriplaceresort.com     # where it points today
```

The site was on WordPress, so expect those A records to point at the old host.
At that provider:

| Host | Type | Value |
|---|---|---|
| `@` | A | `169.58.127.122` |
| `www` | A | `169.58.127.122` |

**Delete every other `A`, `AAAA` or `CNAME` on those two names.** Leftovers
from an old host are what made smp-developers.com go up and down at random.

Wait for it, and check from somewhere that is not the box:

```bash
dig +short A zuriplaceresort.com      # only 169.58.127.122
dig +short A www.zuriplaceresort.com  # only 169.58.127.122
```

## 3. Publish it

```bash
cp /srv/smp-portfolio/repo/deploy/contabo/zuriplace/zuriplace.caddy /srv/edge/sites/
docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile
```

**Only** when that says `Valid configuration`:

```bash
docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
```

A reload is not a restart — the other twenty-odd hostnames keep serving
throughout.

```bash
curl -I https://zuriplaceresort.com
curl -I https://www.zuriplaceresort.com    # expect a 301 to the apex
```

The first request may take a few seconds while the certificate is issued.

## 4. Retire the old site

Once it serves from Contabo, shut down the WordPress host so nothing competes
for the domain and the hacked install stops existing.

---

## Updating later

```bash
cd /srv/zuriplace/repo && git pull
```

That is all. The files are bind-mounted read-only, so Caddy serves the new
ones immediately — no rebuild, no restart, no downtime. Markup, CSS and JS are
sent `no-cache` with an ETag, so a change shows up on the next request while
unchanged files still answer with a cheap 304.

---

## What was verified before this was written

The config was not written from memory. The Caddyfile that ships here was run
against the real site files and exercised:

| Checked | Result |
|---|---|
| `/`, `/rooms`, `/resort`, `/restaurant`, `/safari`, `/contact` | all 200 |
| `/rooms.html`, `/contact.html` | 301 → `/rooms`, `/contact` |
| `/index.html`, `/index` | 301 → `/` |
| A path that does not exist | natural 404, not a redirect loop |
| `/assets/img/*` | `public, max-age=604800` |
| Markup, CSS, JS | `no-cache` |
| `X-Content-Type-Options`, `Referrer-Policy` | present |
| gzip | negotiated |

Both this Caddyfile and the edge drop-in pass `caddy validate`. Every page was
also rendered in a browser at 1440px and 390px: no JavaScript errors and no
missing assets.

**Not verified, because it cannot be from here:** anything involving the live
domain or the box itself. DNS, the certificate, and the containers are checked
by the commands above, on the box.

---

## Why it is shaped this way

- **Bind-mounted, not baked into an image.** The site has no build step, so
  copying it into an image would buy nothing and make every content fix a
  rebuild. `git pull` is the deploy.
- **Read-only mount.** The container cannot alter the checkout, so `git pull`
  is always the whole truth about what is being served.
- **`auto_https off` inside the container.** edge-caddy owns certificates. If
  this container also tried, it would fail, retry, and eventually rate-limit
  the domain — blocking the real certificate too.
- **A drop-in `.caddy` file, not an edit.** Nothing already on the box is
  touched, so adding this site cannot break another one.
- **No `ports:`.** edge-caddy owns 80 and 443. A published port here would
  collide with it.
- **`mem_limit: 128m`.** There is no swap on this box: an unbounded container
  gets another client's database killed rather than itself.

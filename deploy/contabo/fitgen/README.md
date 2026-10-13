# Fit Generations Gym on the Contabo box

Source: **github.com/simboni/fit-generations-gym** (private)
Compose project **`fitgen`** · containers `fitgen-web`, `fitgen-db`

Today it runs on Render. This moves it onto the shared box beside 64theatre,
StackUp and St Stephen's, and switches member payments from Daraja — which
needs a Safaricom shortcode in the gym's own name — to PayHero, which does
not.

## Never run these two

```
ops/install-edge.sh        # stands up ANOTHER Caddy on ports 80/443
ops/caddy-decouple.sh
docker compose up -d       # the default compose file also publishes 80/443
```

That repo was written to be deployable on an empty VPS, so it ships its own
reverse proxy. This box already has one — `edge-caddy` — and it owns 80 and
443 for nineteen hostnames. A second proxy binding those ports takes every
site on the machine down, not just this one.

Use `docker-compose.behind-proxy.yml`, which joins the existing `edge`
network and publishes nothing. It is the repo's own file and it is correct;
patch 0001 only adds the PayHero variables and memory caps to it.

## 1 · Set it up (nothing serving yet)

```bash
bash /srv/smp-portfolio/repo/deploy/contabo/preflight.sh fitgen   # read-only
docker ps --format '{{.Names}}\t{{.Status}}' > /root/before-fitgen.txt

mkdir -p /srv/fitgen
git clone --depth 1 https://github.com/simboni/fit-generations-gym /srv/fitgen/repo
cd /srv/fitgen/repo
git apply /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0001-payhero-payments.patch
cp .env.example /srv/fitgen/repo/.env && chmod 600 .env
```

Fill in `.env`. Generate the secrets rather than inventing them:

```bash
{
  echo "DB_PASSWORD=$(openssl rand -hex 24)"
  echo "AUTH_SECRET=$(openssl rand -hex 32)"
  echo "CRON_SECRET=$(openssl rand -hex 16)"
  echo "PAYHERO_CALLBACK_TOKEN=$(openssl rand -hex 16)"
  echo "ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  echo "APP_URL=https://fitgenerationsgym.com"
  echo "EDGE_NETWORK=edge"
} >> .env
grep '^ADMIN_PASSWORD=' .env     # write this down, then change it in the app
```

The PayHero values are the same account 64theatre uses — copy
`PAYHERO_USERNAME`, `PAYHERO_PASSWORD` and `PAYHERO_CHANNEL_ID` from
`/srv/64theatre/.env`, and set `PAYHERO_DISPLAY_NAME` to the same name
members will see on the prompt.

> **Check `free -m` before building.** This box has no swap and a Next.js
> build is the heaviest thing that happens on it. Under ~1.5 GB available,
> wait.

```bash
cd /srv/fitgen/repo
docker compose -f docker-compose.behind-proxy.yml up -d --build
docker compose -f docker-compose.behind-proxy.yml logs -f fitgen-web
```

## 2 · Prove it answers, before touching anything shared

```bash
docker exec edge-caddy wget -qO- http://fitgen-web:3000/api/health
docker exec edge-caddy wget -qO- --header='Accept: text/html' http://fitgen-web:3000/ | head -5
```

The Accept header matters on apps that serve HTML only to browsers. It costs
nothing here and a silent `/` probe is indistinguishable from a broken
deploy — it cost a day on StackUp.

## 3 · Publish

**There is already a `fitgen.caddy` on this box**, from when the site was
split between here and Render. Read it before replacing it, and keep a copy:

```bash
cat /srv/edge/sites/fitgen.caddy
cp /srv/edge/sites/fitgen.caddy /root/fitgen.caddy.before-$(date -u +%F)
cp /srv/smp-portfolio/repo/deploy/contabo/fitgen/fitgen.caddy /srv/edge/sites/fitgen.caddy

docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile \
  && docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
```

Validate before reload, and reload rather than restart — restarting
`edge-caddy` drops every site on the box at once.

Then confirm nothing else moved:

```bash
for h in smp-developers.com tickets.64theatre.art stackup.co.ke \
         ems.169-58-127-122.sslip.io rizikichemicals.co.ke smpcredits.co.ke; do
  printf '%-34s %s\n' "$h" "$(curl -sSo /dev/null -m 15 -H 'Accept: text/html' -w '%{http_code}' https://$h/)"
done
```

## 4 · DNS

`www.fitgenerationsgym.com` has been pointing at Render (`216.24.57.1`),
which is why its certificate has been failing here. Both names must resolve
to this box:

| Host | Type | Value |
|---|---|---|
| `@` | A | `169.58.127.122` |
| `www` | A | `169.58.127.122` |

Delete every other `A`/`AAAA`/`CNAME` on those names. Do this **before** the
reload: Caddy asks Let's Encrypt on first contact and failed validations are
rate-limited, so wrong DNS does not merely fail, it spends attempts.

## 5 · Payments

PayHero needs nothing from Safaricom, but it does need a funded **service
wallet** — a prepaid balance it spends to send each prompt, separate from the
money being collected. An empty one refuses every prompt while credentials,
channel and callbacks all look healthy.

```bash
bash /srv/smp-portfolio/repo/deploy/contabo/64theatre/payhero-check.sh
```

That reports the balance and warns under KES 20. It reads 64theatre's `.env`,
but the wallet is per PayHero account, so the number covers both apps — and
both apps drain it.

Test one real payment end to end: sign in to the member portal, open an
unpaid invoice, pay the smallest amount the gym sells, and watch the prompt,
the screen and the invoice flip to paid.

## 6 · Back it up

Nothing on this box backs up automatically. Once there are real members:

```bash
bash /srv/smp-portfolio/repo/deploy/contabo/backup.sh --list
```

`fitgen-db` is discovered automatically — it is a Postgres container like the
others.

## Retire Render

Only after a few days of the box behaving. Render is the rollback until then,
and it costs nothing to leave running.

## Updating later

```bash
cd /srv/fitgen/repo && git pull
docker compose -f docker-compose.behind-proxy.yml up -d --build
```

`--build` is not optional: a plain `up -d` reuses the old image and nothing
changes.

# Fit Generations Gym on the Contabo box

Source: **github.com/simboni/fit-generations-gym** (private)
Compose project **`fitgen`** · containers `fitgen-web`, `fitgen-db`

**It is already deployed on this box** — compose project `fitgen`, running
from `/root/fit-generations-gym`, serving fitgenerationsgym.com through
`edge-caddy` since early September. The database is migrated and the volume is
`fitgen_pgdata`.

So this is an UPGRADE, not an install. Do not clone to /srv/fitgen and do not
create a second `fitgen` project: that adopts or destroys the live one's
containers and volume. `preflight.sh fitgen` stops you, and it is right to.

What is actually missing is payments. The app shipped with Daraja, which needs
a Safaricom shortcode in the gym's own name — the weeks-long approval
64theatre avoided — and the live `.env` has no M-Pesa variables at all, which
is why the portal shows "coming soon". Patch 0001 adds PayHero beside Daraja.

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

The deployment is at `/root/fit-generations-gym` and its `.env` already holds
the database password, auth secret and APP_URL. Leave all of that alone.

```bash
docker ps --format '{{.Names}}\t{{.Status}}' > /root/before-fitgen.txt
cd /root/fit-generations-gym
git pull
git apply --check /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0001-payhero-payments.patch \
  && git apply /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0001-payhero-payments.patch
```

Add only the PayHero settings. Read them out of 64theatre's `.env` rather than
retyping secrets — it is the same PayHero account, and a subshell keeps the
values out of this shell and out of history:

```bash
( set -a; . /srv/64theatre/.env; set +a
  {
    echo "PAYHERO_BASE_URL=${PAYHERO_BASE_URL:-https://backend.payhero.co.ke}"
    echo "PAYHERO_USERNAME=$PAYHERO_USERNAME"
    echo "PAYHERO_PASSWORD=$PAYHERO_PASSWORD"
    echo "PAYHERO_CHANNEL_ID=$PAYHERO_CHANNEL_ID"
    echo "PAYHERO_DISPLAY_NAME=${PAYHERO_DISPLAY_NAME:-}"
    echo "PAYHERO_CALLBACK_TOKEN=$(openssl rand -hex 16)"
  } >> /root/fit-generations-gym/.env )

grep -c '^PAYHERO' /root/fit-generations-gym/.env    # expect 6
```

> **Check `free -m` before building.** This box has no swap and a Next.js
> build is the heaviest thing that happens on it. Under ~1.5 GB available,
> wait.

```bash
cd /root/fit-generations-gym
docker compose -f docker-compose.behind-proxy.yml up -d --build
docker compose -f docker-compose.behind-proxy.yml logs -f fitgen-web
```

The named volume `fitgen_pgdata` survives this — `up -d --build` replaces
containers, never volumes. Members and invoices are untouched.

Confirm the variables actually reached the container, which is the failure
that cost days on the theatre deploy:

```bash
docker exec fitgen-web printenv | grep -c PAYHERO     # expect 6
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

The site is already published and the existing `fitgen.caddy` is correct —
the only thing it lacks is `flush_interval -1`. That matters now: the payment
screen polls while a prompt is out and PayHero posts its callback through this
proxy, and a buffering proxy breaks both quietly. Keep a copy before changing
it:

```bash
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

`www.fitgenerationsgym.com` pointed at Render (`216.24.57.1`) for a long
time, which is why its certificate kept failing here. Both names must resolve
to this box — as of 13 October both A records are correct, with a 14400s TTL,
so allow for cached answers:

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

The apex has been served from this box for weeks, so Render is only holding
the old `www` answer and whatever blueprint is still provisioned. Once the new
DNS has fully propagated and payments have been tested, shut the Render
service down — it is not a rollback for anything any more.

## Updating later

```bash
cd /root/fit-generations-gym && git pull
docker compose -f docker-compose.behind-proxy.yml up -d --build
```

`--build` is not optional: a plain `up -d` reuses the old image and nothing
changes.

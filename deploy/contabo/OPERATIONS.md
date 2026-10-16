# Running the box

One machine, six clients, twenty-four containers, one person. This is what
keeps that from becoming a bad week.

Three scripts do the work. None of them changes an application:

| | |
|---|---|
| `status.sh` | Is everything serving right now? Exit 1 if not. |
| `backup.sh` | Nightly database dumps. Reads only. |
| `preflight.sh` | Before deploying anything new, what is already here? |

## Set it up once

```bash
bash /srv/smp-portfolio/repo/deploy/contabo/status.sh            # look at it first
bash /srv/smp-portfolio/repo/deploy/contabo/status.sh --install-cron
bash /srv/smp-portfolio/repo/deploy/contabo/backup.sh --list     # look at it first
bash /srv/smp-portfolio/repo/deploy/contabo/backup.sh --install-cron
bash /srv/smp-portfolio/repo/deploy/contabo/64theatre/scheduler.sh            # look at it first
bash /srv/smp-portfolio/repo/deploy/contabo/64theatre/scheduler.sh --install-cron
```

Run each by hand before installing its cron job. A scheduled job you have
never watched run is a scheduled job you are assuming works.

### Alerts

**There is no MTA on this box**, so cron's own mail goes nowhere. `status.sh`
sends its own, over SMTP with curl, through the same Brevo relay the apps use.
Create `/etc/contabo-alert.env` first:

```bash
cat > /etc/contabo-alert.env <<'EOF'
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<the Brevo SMTP login, the generated …@smtp-brevo.com>
SMTP_PASS=<an SMTP key, xsmtpsib-…>
ALERT_FROM="Box monitor <info@fitgenerationsgym.com>"
ALERT_TO=you@example.com
EOF
chmod 600 /etc/contabo-alert.env

bash status.sh --test-alert
```

`chmod 600` is not cosmetic: that file is a working mail credential, and
anything that can read it can send as your domain.

`--install-cron` refuses to report success without a working alert config, and
sends a test message as part of installing. A monitor that cannot reach anyone
is not a monitor.

Mail only goes out when something fails. The same set of failures repeats at
most every six hours, a **new** failure alerts immediately even while an old
one is open, and a single "recovered" message is sent when it clears —
silence after an alert otherwise reads exactly like the check having died.

## The routine

**Every 15 minutes, automatically.** `status.sh --quiet` checks every
container, every hostname Caddy serves, certificate expiry, disk, memory and
whether a backup has been written in 48 hours. Silence means fine.

**Nightly, automatically.** `backup.sh` dumps every database it can find.

**Weekly, by hand.** Read one full `status.sh` report rather than relying on
silence — it shows warnings that are not yet failures, which is the point at
which they are cheap to fix.

**After every deploy.** `status.sh`. It takes seconds and it is the difference
between finding out from this script and finding out from a client.

## What it checks, and why each one is there

- **Unhealthy-but-running containers.** StackUp sat unhealthy for twenty hours
  because `docker ps` says `Up` and nobody looked closer.
- **Crash loops.** A container restarting every few seconds shows as running
  if you catch it at the right moment.
- **Exited containers that were meant to be running** — judged by restart
  policy, so a one-shot job that finished is not reported as an incident.
- **Every hostname, with `Accept: text/html`.** Several of these apps serve a
  static export only to something that asks for HTML and return 404 to curl's
  default. Without that header this check reports working sites as dead.
- **Certificate expiry.** Caddy renews by itself, which is exactly why failure
  is silent: renewal needs DNS still pointing here, so a certificate quietly
  stops renewing when DNS changes and nobody learns until browsers refuse the
  site.
- **Disk, and the Docker build cache specifically.** The cache reached 31 GB
  on its own. Nothing trims it.
- **Containers with no memory limit.** There is no swap on this box, so a leak
  is not slowness — the kernel kills a process of its choosing, which may be
  another client's database rather than the one at fault.
- **Backup freshness**, because a backup job that silently stopped is
  indistinguishable from one that never existed until the day you need it.
- **Whether 64theatre's scheduler is actually running**, judged by the age of
  its log rather than by the crontab. A container can be green, serving and
  healthy while the work it does on a timer has not happened for weeks: this
  app's expired-order release had never run once, so every abandoned checkout
  was holding its seats off sale with no error anywhere.

## The two things status.sh cannot tell you

**1. The box has drifted from the repositories.** Several apps run patched
working trees: 64 Theatre has seventeen patches applied on top of a HEAD that
contains none of them, and Fit Generations has its own stack. That state lives
in one place — the box — and `git checkout .` in the wrong directory destroys
it.

The patch files in `deploy/contabo/*/patches/` are the reconstruction, which
is why they are checked against a rebuilt copy of the deployed state rather
than against whatever happens to be in a working tree. The real fix is to
commit each app's deployed state to its own repository, so the box can be
rebuilt rather than remembered.

**2. Whether a backup can be restored.** `backup.sh` verifies each dump reads
back (`pg_restore --list`, `gzip -t`), which catches a truncated file. It does
not prove the data is usable. Restore one into a scratch database once, and
you will know — before you need to know.

## When something is wrong

```bash
docker logs --tail 50 <container>          # most apps log to stdout
docker compose -f /srv/<app>/compose.yml up -d --force-recreate
```

`--force-recreate` because Compose reuses a running container when it judges
nothing changed, and most of these apps bake their code into the image. A
summary line reading `Running` rather than `Started` means the old code is
still serving.

**Never** `docker compose down` in a directory you have not read, and never
`docker system prune --volumes` on this machine. Several volumes here are the
only copy of real money and real school records.

Restarting `edge-caddy` drops every site at once. Reload instead:

```bash
docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile \
  && docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
```

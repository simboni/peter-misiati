# Deploying Afya Core

The system is one Node server holding one SQLite file. That file **is** the
facility's clinical record — every consultation, prescription, result, invoice
and claim, plus the hash-chained audit log that makes it evidential. This guide
is mostly about putting that server somewhere reliable and copying that file
somewhere safe, every night, automatically.

**Why HTTPS and not a laptop on the clinic's wifi:** a session is a cookie. On
plain HTTP over a shared network, anybody on that network can take one and
become the clinician whose session it is. There is no version of this system
that is safe to run without TLS.

> Read [`../../docs/hms/06-clinical-review.md`](../../docs/hms/06-clinical-review.md)
> and the README's **Not done** section before a facility relies on this. The
> SHA and KRA connections are simulated, the ICD-11 catalogue is ten codes, and
> seventy items need a named person's signature. Deploying it does not change
> any of that.

## What you need

- A small VPS — 1 vCPU / 2 GB. A busy Level 2 clinic's database after a year is
  measured in tens of megabytes.
- A domain, and an A record pointing at the server's IP.
- Docker and Compose v2 (`curl -fsSL https://get.docker.com | sh`).

## First deployment

```bash
git clone <your-repo> /srv/afya && cd /srv/afya/apps/afya-core

# 1. The domain. Replace afya.example.co.ke with the real one:
nano deploy/Caddyfile

# 2. Start it:
docker compose up -d --build

# 3. Watch it come up:
docker compose logs -f afya
```

The database creates itself on first boot. To put a facility's own details in
rather than the demonstration's, run the seed once and then work through
**Administration → Facility & compliance**:

```bash
docker compose exec afya npm run seed
```

`npm run demo` loads the full demonstration day instead — invented patients, a
queue, claims, a ward. Useful for showing the system; **never** on a machine
that will hold real patients.

## Updating

```bash
cd /srv/afya/apps/afya-core && ./deploy/update.sh
```

That script is the whole procedure, in this order and for this reason:

    snapshot → pull → BUILD → stop → start → verify

The build happens while the old version is still serving, so a build that fails
leaves the clinic running on what it had. Building after stopping would take a
clinic down to find out whether the new version compiles.

It refuses to run at all if the checkout has uncommitted changes — a server is
not a place to edit code — or if the pull would not be a fast-forward. It takes
a snapshot **before** the pull, so what it saves is the database as it was when
the clinic was last known good. Afterwards it waits for the app to answer and
then re-checks the file, its foreign keys and the audit chain.

Exit codes: `0` updated or already current, `1` refused before anything
changed, `2` something failed after the new version started — the message names
the snapshot to go back to.

**No migration step, ever.** The schema is `CREATE TABLE IF NOT EXISTS`
throughout and new columns are added on boot by `db.ts`, guarded by what the
table already has. An update is additive or it is not deployed.

## Backups — set this up the same day

```bash
crontab -e
# 02:30 Nairobi, every night:
30 2 * * * cd /srv/afya/apps/afya-core && docker compose exec -T afya npm run backup
```

`VACUUM INTO`, not `cp`: the live file is in WAL mode and a plain copy can tear
across the write-ahead log, producing a file that opens, looks fine, and is
missing the last consultation. Every snapshot is integrity-checked **and has
its audit chain re-verified** before it counts as a backup. Snapshots land in
`data/backups/`, named to the minute, keeping the most recent 60.

These live on the same machine, which protects against a mistake and not
against a fire. **Take a copy off the machine weekly** — `scp` the newest
snapshot somewhere else, or sync `data/backups/` to storage the facility
controls. A clinical record under the Data Protection Act 2019 is one the
facility must still have after its server is stolen.

### Restoring

```bash
docker compose stop afya
cp data/backups/afya-2026-09-16-0230.db data/afya.db
rm -f data/afya.db-wal data/afya.db-shm     # stale WAL beside a restored file
docker compose start afya
docker compose exec -T afya npm run check
```

## Checking it

```bash
docker compose exec -T afya npm run check
```

Three answers: whether SQLite can still read its file, whether any row points
at something that is not there, and whether the audit chain still verifies.

**A broken audit chain is not a bad deployment.** It means a record was altered
outside the application, and rolling the code back does not address it. Keep
the file — it is evidence — and go back to the last snapshot whose chain
verified. Worth a nightly cron of its own:

```bash
0 3 * * * cd /srv/afya/apps/afya-core && docker compose exec -T afya npm run check || \
  echo "Afya Core failed its checks" | mail -s "Afya Core" you@example.com
```

## Sync, if the facility carries batches

`AFYA_SYNC_DIR` in `docker-compose.yml` is where `/sync` writes and looks for a
batch — `data/sync` by default, which is inside the mounted volume. On a
machine where somebody plugs a stick in, point it at the mount point and mount
that path into the container too:

```yaml
    volumes:
      - ./data:/app/data
      - /media/usb:/mnt/stick
    environment:
      AFYA_SYNC_DIR: /mnt/stick
```

A carried batch is **neither signed nor encrypted** (register rule 26.11). Its
digest catches a file that arrived torn, not one that was deliberately
rewritten, and anybody who picks the stick up can read every operation on it in
plain text. Before patient data leaves a building on a stick, that needs
fixing and the facility needs a data protection impact assessment.

## The go-live checklist

1. **Change every shipped password.** `ChangeMe123` is on every seeded account.
2. **Facility & compliance** — KMHFL code, SHA and KRA identifiers, ODPC
   registration. These print on invoices and go into claims.
3. **Staff & licences** — real people, real KMPDC/NCK/COC/KMLTTB/KRB numbers.
   The system refuses licensed work to a lapsed registration, which is only
   useful if the registrations are real.
4. **Thresholds & sign-off** — work down that screen with the people named on
   each row. Most red rows in the clinical review register close here, with no
   code change.
5. **Take a backup, then restore it onto a spare machine.** A backup nobody has
   restored is a belief, not a backup.

## If something goes wrong

- **Won't start**: `docker compose logs --tail=50 afya`. The commonest cause
  after an update is a half-pulled build — `docker compose up -d --build afya`.
- **"No space left"**: `data/backups/` first, then `docker system prune`.
- **Wrong numbers on screen**: do not edit the database by hand. Every
  correction has a path in the application, and a hand edit breaks the audit
  chain — which is the one thing in here that cannot be repaired, only
  detected.

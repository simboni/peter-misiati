# TallyPay on the Contabo box

Moving TallyPay off Cloudflare Workers + D1 onto this server, serving
`tallypay.smp.co.ke` as its only host. `tallypay.co.ke` is retired along with
the Cloudflare deployment — its zone holds nothing but the Worker's
auto-created placeholder record (no MX, no TXT), so nothing else depends on it.

The one thing that does depend on it is the **published Android app**, which is
built against the old host. Step 7 rebuilds it.

Follow the steps in order. Nothing shared is touched until step 6, and every
step before it is reversible.

| | |
|---|---|
| **App directory** | `/srv/tallypay` |
| **Container** | `tallypay`, port 3000, `edge` network only |
| **Data** | SQLite on volume `tallypay_tallypay-data`, file `/data/tallypay.db` |
| **Hostname** | `tallypay.smp.co.ke` (A record on the smp.co.ke zone → this box) |
| **Rollback** | the Cloudflare deployment, untouched until you delete it |

> **Read `../ADDING-AN-APP.md` first.** The five rules apply here: no host
> ports, own everything you create, join `edge` and never modify it, add a site
> file rather than editing one, and `caddy validate` before `caddy reload`.

---

## 0. Prove the names are free

```bash
bash /srv/smp-portfolio/repo/deploy/contabo/preflight.sh tallypay tallypay.smp.co.ke
docker ps --format '{{.Names}}\t{{.Status}}' > /root/before-tallypay.txt
```

## 1. Get the code

```bash
mkdir -p /srv/tallypay
git clone --depth 1 --branch <self-hosting-branch> \
  https://github.com/simboni/peter-misiati.git /srv/tallypay/repo
cp /srv/tallypay/repo/deploy/contabo/tallypay/compose.yml /srv/tallypay/compose.yml
cp /srv/tallypay/repo/deploy/contabo/tallypay/env.example  /srv/tallypay/.env
```

## 2. Fill in `/srv/tallypay/.env`

**Use the SAME `BETTER_AUTH_SECRET` as the Cloudflare deployment.** It signs
session cookies *and* derives the key that encrypts each vendor's stored M-Pesa
credentials. A new value logs everyone out and makes stored payment secrets
permanently undecryptable. Read it off the old deployment first:

```bash
# from a machine logged into Cloudflare
npx -y wrangler secret list --name billing-platform    # names only; the value
                                                       # is write-only, so use
                                                       # your own record of it
```

If you genuinely cannot recover it, generate a new one — but know that every
vendor must re-enter their Kopo Kopo credentials afterwards.

Set `BETTER_AUTH_URL=https://tallypay.smp.co.ke`.

## 3. Build and start — still private

```bash
cd /srv/tallypay && docker compose up -d --build
docker compose logs -f app        # watch migrations run, then "starting server"
```

The entrypoint applies migrations before serving. On a fresh volume that
creates all 27 tables; after the import in step 5 it finds nothing to do.

## 4. Prove it works before touching anything shared

```bash
docker exec edge-caddy wget -qO- --header='Accept: text/html' \
  http://tallypay:3000/ | head -20
```

The `Accept` header is not optional — this app serves HTML to browsers, and a
bare probe sending `*/*` can read as a 404 on a perfectly healthy container.

## 5. Bring the production data across

**On your laptop**, where wrangler is logged into Cloudflare:

```bash
npx -y wrangler d1 export billing-db --remote --output=tallypay-data.sql
scp tallypay-data.sql root@<box>:/srv/tallypay/import/
```

(`npx` asks "Ok to proceed?" — answer `y`, or pass `-y` as above. Typing
anything else cancels the install and no file is written.)

**On the box:**

```bash
mkdir -p /srv/tallypay/import
bash /srv/tallypay/repo/deploy/contabo/tallypay/migrate-data.sh \
     /srv/tallypay/import/tallypay-data.sql
```

That script stops the app so no writes land mid-import, backs up the current
volume to `/root/tallypay-backups/`, loads the dump into a temp file, verifies
it, and only then swaps it in. It refuses to swap in a database with zero
invoices and prints the exact command to restore.

**Compare the printed counts against production D1 before going further.** They
must match exactly:

```bash
npx -y wrangler d1 execute billing-db --remote --command \
  "select (select count(*) from invoice) invoices,
          (select count(*) from invoice_line) lines,
          (select count(*) from payment) payments,
          (select sum(total) from invoice) invoiced;"
```

## 6. Publish the hostname

Add an A record for `tallypay.smp.co.ke` on the **smp.co.ke** zone pointing at
this box, then:

```bash
bash /srv/tallypay/repo/deploy/contabo/tallypay/publish.sh
```

It snapshots every hostname edge-caddy serves, writes **one new file**
(`/srv/edge/sites/tallypay.caddy`), validates, reloads, re-probes every site,
and rolls back automatically if anything that worked before stops working.

```bash
# the whole guarantee: this should print nothing
diff <(docker ps --format '{{.Names}}\t{{.Status}}' | grep -v tallypay) \
     <(grep -v tallypay /root/before-tallypay.txt)
```

## 7. Rebuild and resubmit the Android app

**The app on Play is broken the moment tallypay.co.ke stops answering.** It is
a Capacitor shell whose `server.url` points at the old host, so retiring that
domain leaves every installed copy loading nothing. Plan this step before you
tear anything down.

The source change is already committed: `mobile/capacitor.config.json` now
points at `https://tallypay.smp.co.ke/dashboard`, and `versionCode` is **6**
(Play rejects a re-used version code).

1. Build it: Actions → **Build mobile app (Android)** → Run workflow.
2. Download the signed `.aab` from the run's artifacts.
3. Play Console → **Production** → create release → upload → roll out.
4. Wait for review to clear and the update to reach users.

**Keep tallypay.co.ke resolving to the Cloudflare deployment until that update
has actually rolled out.** Users on the old build have no other way in. Only
once Play shows the new version adopted should you let the old domain go.

That is also why step 10 (decommissioning) is last and deliberately unhurried.

## 8. Re-point M-Pesa

In the Kopo Kopo dashboard, change the webhook URL to:

```
https://tallypay.smp.co.ke/api/mpesa/kopokopo
```

Until this is done, STK payments will be taken but **not reconciled into
receipts** — the callback still goes to the old Cloudflare deployment.

## 9. Back it up — same sitting

This is real money data on a box with no provider backups. Add the volume to
`../backup.sh`; the database is a single file, so a nightly

```bash
docker run --rm -v tallypay_tallypay-data:/data -v /root/tallypay-backups:/b \
  alpine:3 sh -c 'apk add --no-cache sqlite >/dev/null;
                  sqlite3 /data/tallypay.db ".backup /b/tallypay-$(date -u +%F).db"'
```

is a consistent copy even while the app is running (`.backup` is safe on a live
database; plain `cp` is not).

## 10. Decommission Cloudflare — last, and not soon

Only once **all** of these are true:

- [ ] The new deployment has run clean for a couple of weeks
- [ ] The data import was verified and nightly backups are running
- [ ] M-Pesa payments reconcile into receipts on the new host
- [ ] The rebuilt Android app (versionCode 6) is live on Play **and adopted**

Then, in order:

1. Delete the Worker custom domain for `tallypay.co.ke` (this also removes the
   auto-created `AAAA 100::` record — the zone's only record).
2. Delete the `billing-platform` Worker.
3. **Export D1 one final time and keep the dump offline** before deleting the
   database. That dump is your last copy of the old-world data.
4. Let the `tallypay.co.ke` registration lapse, or park it.

Until step 1, the Cloudflare deployment stays as a complete rollback: it still
has the code, the data as of migration day, and a working domain.

---

## Updating later

```bash
cd /srv/tallypay/repo && git pull
cd /srv/tallypay && docker compose up -d --build
```

Migrations apply automatically on start. To add a schema change: `npm run
db:generate` in `billing/`, commit the new file in `billing/drizzle/`, pull and
rebuild.

## If something looks wrong

```bash
docker compose -f /srv/tallypay/compose.yml down
```

Removes only TallyPay's container and its edge attachment. The data volume
survives and nothing else on the box is affected.

**Full rollback to Cloudflare:** `bash publish.sh --unpublish`, then point DNS
back. The Workers deployment and its D1 database are untouched by any of this —
keep them until you have run on this box for a few weeks.

## Never run these

```bash
docker compose down                 # in a directory you did not create
docker system prune -a --volumes    # deletes client databases
docker volume rm tallypay_tallypay-data
docker network rm edge
docker restart edge-caddy           # use `caddy reload`
```

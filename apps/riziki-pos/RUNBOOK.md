# Riziki POS — recovery runbook

**For the person holding the server password, with no AI and no developer on
call.** Every procedure here is a command you can type, or a decision only a
human should make. Nothing in it requires knowing how the code works.

Keep a printed copy at the shop and a copy on your phone. When the server is
down you cannot read it on the server.

```
The shop:     https://pos.rizikichemicals.co.ke
The server:   ssh root@169.58.127.122        (Contabo VPS, vmi3487264)
The code:     github.com/simboni/peter-misiati   branch claude/detergent-mixing-pos-2p5ndu
On the server the code lives at /root/peter-misiati
The database is ONE FILE:   /root/peter-misiati/apps/riziki-pos/data/riziki.db
```

---

## 0. The one thing to remember

**The whole business is that one file.** Not the server, not the container, not
the code — those can all be rebuilt from GitHub in twenty minutes by anyone who
can follow instructions. `riziki.db` is the only thing that cannot.

So the only question that matters is: **is there a copy of it somewhere that is
not this server?** We did not buy the provider's backup add-on, and do not need
to — compressed, the whole database is about 20 kB, so a free Google Drive
account holds years of it:

```
sh deploy/offsite-backup.sh          # set it up once, §8, then cron it nightly
```

And keep the manual one as the backstop: Reports → *Download full backup* → your
phone, weekly. If the VPS died tonight, that file plus these pages is the whole
recovery.

---

## 1. First response — anything at all is wrong

Two commands, in this order. Run them from the server:

```
ssh root@169.58.127.122
cd peter-misiati/apps/riziki-pos
sh deploy/health.sh
```

`health.sh` changes nothing and is safe at any time, including mid-trade. It
prints a screen of lines, each marked `OK` or `!!`:

- whether the three containers are running (`pos`, `web`, `caddy`)
- whether the public address answers, and which build is live
- the database's integrity check, today's sales, the number of owner accounts
- when the last backup was taken, whether the nightly job is still scheduled,
  and when a copy last left this server
- free disk space

**Act on the first `!!` line.** Each has a section below.

If you cannot even reach the server, go to §7.

---

## 2. The shop cannot sell — keep trading first

Before fixing anything, the shop must keep taking money. In order of
preference:

1. **Another device.** The system is a website, not an app. If one phone is
   stuck, open `pos.rizikichemicals.co.ke` on any other phone or laptop and
   carry on. Sign in with the same name and PIN.
2. **Offline.** If there is no network but the counter phone still opens the
   app, **keep selling**. Sales are saved on the phone and send themselves when
   the connection returns. The screen says so. Do not clear the browser data on
   that phone until the queue has gone — that is where the unsent sales live.
3. **On paper.** If nothing opens, write every sale on the duplicate book:
   date, what, how many, price, cash or M-Pesa, and the customer's name if it is
   on credit. Enter them afterwards through the counter, one by one. The system
   was built to be caught up.

Never let a customer walk out unrecorded because a screen is not working.

---

## 3. "The app is down"

```
cd /root/peter-misiati/apps/riziki-pos
docker compose ps                     # which containers are running
docker compose logs --tail 80 pos     # what it said as it died
docker compose up -d                  # start whatever is stopped
```

Nine times out of ten `docker compose up -d` is the whole fix, and it is safe
to run when everything is already up.

If the `pos` container restarts in a loop, the build on disk is broken. Go back
to the last build that worked (§4).

If the website answers but shows the wrong shop system, check what is actually
running:

```
curl https://pos.rizikichemicals.co.ke/build.txt
```

That prints the commit, the branch and the time it was built. If it is older
than your last update, the update did not take — run it again and watch it
finish (§4).

---

## 4. Updating, and going back when an update breaks something

**Update:**

```
sh /root/peter-misiati/apps/riziki-pos/deploy/update.sh
```

Type it, do not paste — pasting into that terminal has brought in invisible
`^[[200~` characters before. Always use the script, never `git pull` on its
own: a server parked on the wrong branch looks exactly like one that is up to
date.

**Go back to the previous build** — the fix when an update makes things worse:

```
cd /root/peter-misiati
git log --oneline -10                    # pick the commit before the bad one
git checkout <that-commit-id>
cd apps/riziki-pos
docker compose up -d --build
```

Nothing about that touches the database. To return to the latest again, run
`update.sh`.

---

## 5. Nobody can sign in

An owner PIN resets any other PIN — but only from inside the app. If the owner
PIN itself is lost, or the only owner account was switched off, there is no way
in through any screen. That is what this is for:

```
cd /root/peter-misiati/apps/riziki-pos
sh deploy/reset-owner-pin.sh                      # lists the accounts
sh deploy/reset-owner-pin.sh "Peter" 7391         # sets that one
```

It backs up first, sets the PIN, makes that account an active owner, and signs
that person out of every phone so the old PIN opens nothing. It refuses a name
that does not exist — it will not invent an account.

Sign in, then change the PIN on the phone: **Menu → Change my PIN**.

---

## 6. The figures are wrong, or data has been lost

**Wrong figures are almost never a lost database.** Work down this list before
restoring anything, because a restore throws away everything recorded since the
snapshot.

| What it looks like | Where to look first |
|---|---|
| Stock is higher or lower than the shelf | **Stock → tap the item.** Every entry, with who and when. The row that moved it is named. |
| Profit looks too high | **Reports.** A red line names sales with no cost price — those show as pure profit until the cost is recorded. |
| A month includes trial figures | **Users & settings → The books start on.** Set it to the day the shop was cleared (11 September 2026). |
| A sale is wrong | **Sales → Void** it, with a reason, and ring it up again. Nothing is deleted; both entries stay. |
| A delivery is wrong | **Purchases → the delivery → Correct** what arrived and what it cost. |
| Someone says a number changed by itself | **Menu → Activity log.** Every sign-in, price change, void and payment, with a name against it. |

**Never edit the database by hand.** The tables refuse it anyway — sales, stock
movements and price changes are append-only by design, which is what makes the
audit trail worth anything.

**Restoring a backup** — only when the database is genuinely damaged or lost:

```
cd /root/peter-misiati/apps/riziki-pos
sh deploy/restore-backup.sh                                   # lists snapshots
sh deploy/restore-backup.sh data/backups/riziki-2026-09-14.db
```

It proves the snapshot opens and passes its integrity check before touching
anything, moves the current database aside rather than deleting it (so a
restore to the wrong day can itself be undone), removes the write-ahead files
that would otherwise mix two days together, and brings the shop back up even if
something fails halfway.

Afterwards, **re-enter by hand everything that happened after that snapshot**:
the day's sales from the duplicate book, any delivery, any payment.

---

## 7. The server is gone

A dead VPS, a lost password, a provider problem. The recovery is: new server,
same code, restore the file.

1. Any VPS with Docker, or a new Contabo one. Point the three DNS A records at
   its IP: `rizikichemicals.co.ke`, `www.` and `pos.`. Caddy fetches the HTTPS
   certificates itself once DNS resolves.
2. On the new server:
   ```
   git clone https://github.com/simboni/peter-misiati.git
   cd peter-misiati/apps/riziki-pos
   git checkout claude/detergent-mixing-pos-2p5ndu
   mkdir -p data
   # put your most recent backup here as data/riziki.db
   docker compose up -d --build
   ```
3. `sh deploy/health.sh`, then sign in and check today's figures.
4. Set the nightly backup up again — §8.

`DEPLOY.md`, beside this file, has the longer version of the same thing.

**Without an off-server backup, step 2 gives you a working system with an empty
shop.** That is the whole reason for the weekly download.

---

## 8. Backups — prove they are running

Nightly, on the server, at 2:30am Nairobi:

```
crontab -l                    # look for: npm run backup
crontab -e                    # add it if it is missing:
30 2 * * * cd /root/peter-misiati/apps/riziki-pos && docker compose exec -T pos npm run backup
```

Snapshots land in `data/backups/`, thirty are kept, and each is
integrity-checked before it counts as one. Take one right now, any time:

```
docker compose exec -T pos npm run backup
```

Those live on the same machine. They protect against a mistake — a bad stock
take, a restore to the wrong day — and against nothing else. **A dead server
takes them with it.**

### Getting a copy off the server, for nothing

We did not buy the provider's backup add-on, and it is not needed, because of
one fact about this shop's data: **the entire database, compressed, is about
20 kB.** A year of trading will not make it a megabyte. Backing it up is not a
storage problem — it is a "copy a small file somewhere else every night"
problem, and any free account already does that.

```
sh deploy/offsite-backup.sh
```

It snapshots, compresses, sends, prunes anything older than 90 days at the far
end, and writes `data/offsite-last.txt` so `health.sh` can tell you when a copy
last left the building. Configure a destination once, in
`deploy/offsite.env` (not in the repository — it names your account):

```
RIZIKI_OFFSITE_RCLONE="gdrive:riziki-backups"
RIZIKI_OFFSITE_SCP="peter@192.168.1.5:/Users/peter/riziki-backups"
```

Set either, or both and it sends to both.

**Google Drive, ten minutes, no cost** — you already have the account:

```
apt-get install -y rclone
rclone config          # n → name it "gdrive" → choose "drive" → accept the
                       # defaults → paste the code it prints into a browser
rclone mkdir gdrive:riziki-backups
sh deploy/offsite-backup.sh
```

Then have it run itself, half an hour after the nightly snapshot:

```
crontab -e
0 3 * * * cd /root/peter-misiati/apps/riziki-pos && sh deploy/offsite-backup.sh >> /var/log/riziki-offsite.log 2>&1
```

**The alternatives, if Drive does not suit:** the free tier of Backblaze B2
(10 GB) or any S3-compatible store, both via the same `rclone` line; or
`RIZIKI_OFFSITE_SCP` to your own laptop or a second cheap VPS, which needs an
ssh key on that machine because cron cannot answer a password prompt.

**And keep the manual one as the backstop.** Reports → *Download full backup* →
your phone, weekly. It costs two taps, it does not depend on the server being
healthy enough to run a script, and it is the copy you will actually have in
your hand if the VPS is gone.

### Restoring from an off-site copy

The file is a plain gzipped database. Uncompress it, put it under `data/`, and
run the restore as normal:

```
gunzip -c riziki-2026-09-14.db.gz > /root/peter-misiati/apps/riziki-pos/data/backups/riziki-2026-09-14.db
cd /root/peter-misiati/apps/riziki-pos
sh deploy/restore-backup.sh data/backups/riziki-2026-09-14.db
```

`health.sh` tells you the age of the newest snapshot AND when a copy last left
the server. If either is older than it should be, that job has stopped.

---

## 9. The disk is full

Writes fail while deletes still work, so clear space and the shop recovers:

```
df -h .                                   # what is left
docker system prune -a                    # old images: usually gigabytes
ls -lt data/backups | tail -20            # older snapshots, if truly needed
```

Do not delete `data/riziki.db`, anything named `riziki.db.replaced-*` that you
have not finished with, or the newest few snapshots.

---

## 10. The printer

Bluetooth printing is between the phone and the printer; the server is not
involved, so it is never the cause of a printing problem.

- **Chrome on Android.** Safari and every browser on an iPhone lack Web
  Bluetooth entirely and always will.
- Pair once per device: **Menu → Receipt printer → Choose printer**, then print
  the test receipt.
- A dual-mode printer shows twice in the pairing list. Only one of the two
  entries works — pick the other if the first will not print.
- Receipts are never lost by a printer failure. Any sale can be reprinted from
  **Sales → Invoice**.

---

## 11. What to hand a new developer

Everything needed is in the repository, which is the point:

| File | What it is |
|---|---|
| `AGENTS.md` | The three traps this toolchain has already sprung. Read first. |
| `DEPLOY.md` | First deployment, DNS, backups, updating. |
| `RUNBOOK.md` | This file. |
| `USER-GUIDE.md` | What the shop staff are told. |
| `CONTRACT.md` | What was agreed and delivered. |
| `src/lib/*.ts` | The business rules. Every file opens with why it exists, not what it does. |
| `tests/` | `npm test` — 353 tests. If they pass, the money arithmetic is intact. |

Tell them three things before they touch anything:

1. **The ledger is append-only.** Sales, stock movements, pack moves and price
   changes cannot be updated or deleted — database triggers refuse it. Every
   correction is a further entry. Do not try to work around it; that rule is
   the audit trail.
2. **Money is integers.** Cents for money, thousandths ("milli") for
   quantities. No floats anywhere near a price.
3. **The shop is UTC+3, always.** Every report groups by `date(at, '+3 hours')`.
   Group by raw UTC and the drawer stops agreeing with the report.

To work on it locally: `npm install`, `npm run seed`, `npm run dev`, open
`localhost:3100`. No server, no Docker, no keys needed.

---

## 12. The five-minute monthly check

Do these on the first of the month and you will not meet most of this document:

1. `sh deploy/health.sh` — read every line, including "a copy left this server".
2. Reports → *Download full backup* → save it off the server, by hand, as the
   backstop to the nightly off-site job.
3. Menu → Activity log — read the month: voids, price changes, failed sign-ins.
4. Users & settings — switch off anyone who has left; clear any account still
   on its starting PIN.
5. Stock — settle anything showing as owed next door.

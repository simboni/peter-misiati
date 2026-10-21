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

## Deploying — read this first

Everything from section 10 onwards goes on with **one command**:

```bash
cd /srv/smp-portfolio/repo && git fetch origin claude/portfolio-design-plan-9ol8sb
bash deploy/contabo/fitgen/deploy.sh --status    # what is on, what is waiting
bash deploy/contabo/fitgen/deploy.sh --dry-run   # rehearse it, change nothing
bash deploy/contabo/fitgen/deploy.sh             # apply, rebuild, check it came back
```

The per-section `git apply` lines below are still accurate and still work;
they are kept because they say what each patch is for. But the script is the
one to run, because it gets three things right that typing them does not:

- **It is all-or-nothing.** Every pending patch is rehearsed in a throwaway
  git index first — the real run, in order, accumulating — and if any one of
  them will not apply, nothing is touched and nothing is rebuilt. A
  half-patched checkout is the state that is hard to get out of.
- **It knows what is already on.** This checkout **cannot** be reconstructed
  from its base — 0005 and 0007 do not reapply — so unlike 64theatre there is
  no reset-and-replay. Patches go on forward only, once each, and the box
  keeps a ledger at `/srv/fitgen/deploy-state/applied.txt` saying which. That
  file, not a guess, decides what runs. (`git apply --reverse --check` is not
  a safe way to ask: an early patch stops reversing cleanly the moment a
  later one touches the same lines, so it is wrong in exactly the cases that
  matter.)
- **It rebuilds properly and proves the site came back.** `--build
  --force-recreate`, then it waits for `/api/health` *and* for `/pricing` to
  render, because the pricing page now reads the database and a health
  endpoint that only proves the process is up would not notice it failing.

Before applying it saves a working-tree diff and a `pg_dump` to
`/srv/fitgen/before-deploy/`, and tags the running image `fitgen-web:before-<stamp>`
so there is a way back. It prints the rollback commands if anything fails.

On the first run there is no ledger, so it treats 0001–0007 as already on —
which is what README sections 1–8 did by hand. If your box is actually
missing one of those, the first patch that needs it fails its rehearsal, the
script stops, and nothing is rebuilt.

**Verified before shipping:** run against a replica of this box's checkout,
the resulting tree is byte-for-byte the tree that was tested in a browser.
Re-running says "nothing to apply"; a hand-edited file makes it abort
without touching anything.

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

**The patches are ordered and each assumes its predecessors.** They touch the
same compose file and `.env.example`, so applying 0003 before 0001 — or
checking one against the wrong starting state — fails with `patch does not
apply`. Apply 0001 through 0007 in order.

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

A value containing spaces must be quoted in the source file — `set -a` plus
`.` assigns the first word and tries to run the rest as a command, which is
how `PAYHERO_DISPLAY_NAME=GLOBE GAIN PIPSPRO` became `GLOBE` and printed
`GAIN: command not found`. Check 64theatre's file is quoted before copying
from it.

```bash
grep '^PAYHERO_DISPLAY_NAME' /srv/64theatre/.env   # must be quoted if it has spaces

( set -a; . /srv/64theatre/.env; set +a
  {
    echo "PAYHERO_BASE_URL=${PAYHERO_BASE_URL:-https://backend.payhero.co.ke}"
    echo "PAYHERO_USERNAME=$PAYHERO_USERNAME"
    echo "PAYHERO_PASSWORD=$PAYHERO_PASSWORD"
    echo "PAYHERO_CHANNEL_ID=$PAYHERO_CHANNEL_ID"
    echo "PAYHERO_DISPLAY_NAME=\"${PAYHERO_DISPLAY_NAME:-}\""
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

## 6 · Email

Patch 0003 adds an SMTP provider to `messaging.ts` and — the load-bearing
half — names the `SMTP_*` variables in the compose file. Without that, the
container sees nothing however correct `.env` looks. It is the same omission
that made PayHero inert, and it will keep being the same omission.

```bash
cd /root/fit-generations-gym
git apply --check /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0003-smtp-email.patch \
  && git apply /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0003-smtp-email.patch
grep -c SMTP_ docker-compose.behind-proxy.yml     # expect 6
```

Then the Brevo settings. `SMTP_USER` is Brevo's **generated login**, not the
gym's address — authenticating as `info@` fails, and the failure looks exactly
like a wrong password:

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<the Login from Brevo -> SMTP & API -> SMTP tab>
SMTP_PASS=<an SMTP key, xsmtpsib-… — an API key, xkeysib-…, gives 535>
MAIL_FROM="Fit Generations Gym <info@fitgenerationsgym.com>"
```

`MAIL_FROM` needs the **domain** authenticated under Brevo → Senders, Domains
& Dedicated IPs. Single-sender verification is not an option here: Brevo mails
a confirmation link to the address, and no mailbox exists behind `info@`.

Rebuild with `--build`. It is not optional — 0003 adds nodemailer to
`package.json`, and restarting the old image gives `Cannot find module
'nodemailer'` on the first send:

```bash
docker compose -f docker-compose.behind-proxy.yml up -d --build
docker exec fitgen-web printenv | grep -c SMTP_   # expect 4
```

Prove the whole chain from inside the container, which tests the environment
and the module together:

```bash
docker exec fitgen-web node -e "
require('nodemailer').createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}).sendMail({
  from: process.env.MAIL_FROM, to: 'misiatipeter@gmail.com',
  subject: 'Fit Generations SMTP test', text: 'Brevo relay is live.',
}).then(i => console.log('OK', i.messageId), e => { console.error('FAIL', e.message); process.exit(1); });
"
```

Patch 0003 gives a working pipe and nothing using it: `sendEmail` has one
caller, password reset. Patch 0005 is what actually sends to members.

## 7 · Member emails

```bash
cd /root/fit-generations-gym
git apply --check /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0005-member-emails.patch \
  && git apply /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0005-member-emails.patch
```

Add one line to `.env` — mail goes out as `info@`, which on Brevo can send but
has no inbox, so without this a member's reply bounces:

```
MAIL_REPLY_TO="misiatipeter@gmail.com"
```

No new dependency, so a plain restart is enough:

```bash
docker compose -f docker-compose.behind-proxy.yml up -d
```

Six emails, at the points where the state already changes: invoice issued,
payment received (full or partial), membership activated, expiring within
seven days, expired, invoice overdue. There is no admin approval step in this
app — `pending` means awaiting payment and payment activates the membership —
so the "approval" email is the activation one.

**It is an outbox, not a send.** Every one of these fires inside
`saveDB(mutator)`, which is synchronous and unlocked, so sending from in there
would let an SMTP timeout abort a recorded payment. The mutation writes a
reminder row with `status: "queued"`; `drainReminderEmails()` sends after the
transaction commits. A failed send stays queued and the next tick retries it.

That also makes the admin panel honest. These rows were written
`channel: "in-app", status: "sent"` — marked sent when nothing had been sent.
`/admin/notifications` now shows the real delivery state, amber for queued.

### Proving it

The relay test in section 6 proves SMTP. This proves the app:

```bash
curl -sS -X POST -H "Authorization: Bearer $(grep '^CRON_SECRET' /root/fit-generations-gym/.env | cut -d= -f2-)" \
  https://fitgenerationsgym.com/api/cron/tick
```

The response carries `emailed` and `emailFailed`. With no members it will
report zeros — correct, not broken. Create a member with a real address,
assign a plan, and the invoice email goes out on the spot.

```bash
docker exec fitgen-db psql -U fitgen -d fitgen -tA -F' | ' -c \
"select data->>'type', data->>'channel', data->>'status', data->>'memberName'
   from reminders order by data->>'createdAt' desc limit 10;"
```

Anything still `queued` on the next day is a mail fault worth chasing, and
`docker logs fitgen-web | grep notify` will name it.

### The cap

`BATCH = 40` per drain. Brevo's free tier allows 300 a day, so a first tick
across a long member list cannot spend the quota in one go — the remainder
stays queued for the next run instead of failing in a heap. Raise it only
after checking the plan's real daily limit.

## 8 · Reversing payments, and the service fee ledger

```bash
cd /root/fit-generations-gym
git apply --check /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0007-void-and-service-fees.patch \
  && git apply /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0007-void-and-service-fees.patch
docker compose -f docker-compose.behind-proxy.yml up -d --build
```

**`--build`, always.** The Dockerfile does `COPY . .` then `npm run build`, so
the source is compiled into the image. A plain `up -d` restarts the old code
and the patch appears to have done nothing.

### Reversing a payment

Voiding an invoice already existed; reversing a payment did not, and a paid
invoice could not be voided at all. Now there is a **Reverse** button on every
live payment, on the ledger and on the invoice.

The row is kept and marked `Reversed`, not deleted — deleting would leave a
member holding a receipt for something the books say never happened. Every
total excludes reversed rows: revenue, method split, the month's collections
and the income chart all read from one filtered list, because two figures on
one screen disagreeing is worse than both being wrong.

A reversal is not only about money. If the payment settled an invoice, it also
activated a membership, so the membership goes back to `pending` and the
member's status with it — otherwise the gym hands out access paid for with
money that has been taken back. Both membership dates are cleared so that
re-paying later recomputes the window from that day and the member does not
lose the days in between.

A **paid** invoice still cannot be voided directly. Reverse its payments first
and the Void button appears. That ordering is deliberate: it keeps the audit
trail in the right sequence instead of destroying payment records.

### Service fees

A **Service fees** panel under Payments & Billing showing what the gym owes —
PayHero's cut and the platform fee — per month, with a **Pay** button that
records settlement and books it as an expense so the gym's own margin figures
include the cost of collecting money. **Undo** reverses a mis-click.

Rates are set under **Settings → Service fees** and default to **zero**: a fee
nobody agreed to must not appear by itself.

Four things about the design, because this is the one figure where the
supplier bills the client and it has to survive being questioned:

- **Derived, never typed in.** An unpaid period is recomputed from the payment
  ledger on every tick, on every payment, on every reversal and whenever a
  rate changes. Nobody can nudge the number, and reversing a member's payment
  shrinks the fee automatically.
- **Rates live in settings**, on a screen the gym can open — not in code or an
  env var they cannot see.
- **Every row shows its arithmetic.** "1.5% of KSh 48,000 over 12 payments",
  not a bare total. A fee the client cannot check is a fee they will dispute.
- **A paid period is frozen.** Recomputation skips it. A settled bill must
  never move afterwards; that is a credit note conversation, not a silent
  edit.

Gateway fees apply only to M-Pesa and card. Cash over the desk costs PayHero
nothing and billing for it would be indefensible.

Set the rates, then:

```bash
docker exec fitgen-db psql -U fitgen -d fitgen -tA -F' | ' -c \
"select data->>'period', data->>'kind', data->>'amount', data->>'status', data->>'basis'
   from service_charges order by data->>'period' desc;"
```

The table is created automatically on boot — `ensureSchema` is idempotent DDL,
so no migration step.

## 9 · Back it up

Nothing on this box backs up automatically. Once there are real members:

```bash
bash /srv/smp-portfolio/repo/deploy/contabo/backup.sh --list
```

`fitgen-db` is discovered automatically — it is a Postgres container like the
others.

## 10 · Joining goes to the member area, and Coach Emmanuel comes off

```bash
cd /root/fit-generations-gym
git apply --check /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0008-member-area-ctas-and-signout.patch \
  && git apply /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0008-member-area-ctas-and-signout.patch
docker compose -f docker-compose.behind-proxy.yml up -d --build
```

`--build`, as always: `COPY . .` bakes the source into the image, so a plain
`up -d` restarts the old code and the patch looks like it did nothing.

This patch touches nine files and **none of them appear in 0001–0007**, so it
can go on whatever state the box is in. That matters here: 0005 and 0007 do
not reverse cleanly against a rebuilt baseline, so unlike 64theatre this app
cannot be reset-to-base-and-reapplied. Patches have to go on in order, once
each, on top of what is already there.

It carries two **deleted JPEGs**, which is why the file is ~230 KB. It was
generated with `git diff --binary`; without that flag `git diff` writes an
abbreviated index line for a binary file and `git apply` refuses the whole
patch with *"cannot apply binary patch … without full index line"*. Any
future patch that adds or removes an image needs the same flag.

### Joining now lands in the member area

Before this, **Enroll Now** on the pricing page opened **WhatsApp**. Somebody
ready to pay was handed off to a chat thread and a human who had to be awake.
It now goes to `/portal/signup`. WhatsApp is still there as a second,
quieter link — *"Or ask us about this plan"* — because asking a question
before paying is a real thing people want; it is just not the main path.

**Become a Member** in the closing band pointed at `/pricing`, which is the
page the visitor was most likely already on. It also goes to `/portal/signup`.

### Coach Emmanuel is off the front end

He is named nowhere on the public site: the trainers page, the gallery and the
class timetable. His two photographs are deleted — `public/trainers/
emmanuel-manu.jpg` and `public/gallery/g5.jpg`.

**His five classes stay on the timetable**, without a coach name against them.
Removing the classes as well would have emptied three slots from a schedule
that is advertised and attended, which is a bigger change than was asked for.
`WorkoutSlot.coach` is therefore optional and the label only renders when
there is a name — otherwise the card reads "with Coach" and trails off.

`src/lib/public-assets.ts` is in the patch because it is a **generated file**:
`scripts/generate-asset-manifest.mjs` runs as a prebuild step and rewrites it
from whatever is in `public/`. Editing it by hand is pointless — the build
overwrites it. It is in the patch only so the checked-in copy matches the two
deleted images; the build would regenerate the same thing anyway.

### Signing out of the portal

A member who signed out was redirected to `/login` — the **staff** sign-in.
Same fields, different door, and nothing a member typed there would ever work.
That is almost exactly the reported symptom of "the page freezes on create
account or sign in and will not proceed". Sign-out now reads the role *before*
dropping the cookie — afterwards there is no way to tell a member from a staff
member — and sends members to `/portal/login`.

Both sign-in and sign-out also call `revalidatePath("/", "layout")`. This is
the one place that call does something: the browser about to be shown the
result is the same browser that cached the signed-in pages. (It is **not** a
fix for a member seeing a stale status after the office changes their record —
that stale page is in someone else's Router Cache, which no server action can
reach.)

### Two things found while in here, not fixed

- **Admin prices and public prices are different data.** `/pricing` renders
  hardcoded `planTiers` from `src/lib/gym.ts`; **Settings → Membership** edits
  rows in the database. They were never connected, so a price changed in the
  office never reaches the website, and the amount billed can differ from the
  amount advertised. Worth fixing before the next price change.
- **The login freeze could not be reproduced.** Fourteen checks in a real
  browser — sign up, sign out, sign in, sign out, sign in again, production
  build, same browser throughout — all passed. The wrong-door redirect above
  is the most plausible cause and is fixed, but if it still happens, the URL
  in the address bar at the moment it sticks plus the browser console output
  is what is needed.

## 11 · Part payment, from the member's own portal

```bash
cd /root/fit-generations-gym
git apply --check /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0009-part-payment.patch \
  && git apply /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0009-part-payment.patch
docker compose -f docker-compose.behind-proxy.yml up -d --build
```

Goes on **after 0008** — it shares files with 0005 and 0007, so the chain
order matters here in a way it did not for 0008. No migration: the two new
settings and the one new invoice field are plain columns in the JSON document
the app already stores, and `getSettings` spreads over its defaults, so a
settings row written before this patch reads back complete.

### What it does

A member can clear a membership invoice in instalments instead of all at
once. **Access still starts only when the invoice is clear.** An instalment is
recorded against the balance and nothing else — the membership stays pending,
the member stays inactive, and the screen says so *before* the money leaves
their phone. "But I paid you" at the front desk is the argument this exists to
prevent.

The gym owns the policy, under **Settings → Part payment**: a switch that
turns it off entirely, and the smallest instalment it will accept (default
**KSh 500**). The floor is not decoration — every instalment costs a gateway
fee, so a KSh 50 payment loses money and settles nothing. A balance already at
or below the floor is offered in full, because there is no part of it left
to pay.

The amount is re-decided on the server. The `min` and `max` on the field stop
an honest mistake; they are not the control.

### Three things that would have gone wrong quietly

- **A callback with no `Amount`.** PayHero normally sends one, but a body that
  omits it used to fall straight through to the whole balance. With
  instalments that marks a KSh 1,000 payment as a KSh 3,500 invoice settled in
  full — and activates a membership nobody has paid for. The prompt's own
  amount is now stored beside the checkout id and used before that fallback.
- **The waiting screen watched for `paid`.** An instalment leaves the invoice
  `partially_paid`, so the screen would have sat there spinning long after the
  money arrived, and the member would have paid twice. It now compares what is
  paid against what was paid when the prompt went out, and says what is left.
- **Changing plan mid-instalments.** Picking again would have raised a second
  invoice and left the first instalments against a plan the member had walked
  away from — paid, recorded, buying them nothing. Both the plan picker and
  the action send them back to the open invoice. Changing plan part-way is a
  desk conversation.

### Checking it on the box

```bash
docker exec fitgen-db psql -U fitgen -d fitgen -tA -F' | ' -c \
"select data->>'number', data->>'status', data->>'amountPaid', data->>'balance'
   from invoices where data->>'status' = 'partially_paid';"
```

Every part-paid invoice should have `amountPaid` > 0, `balance` > 0, and its
member should **not** be Active. The admin side needed nothing: the ledger
already recorded a short payment as `Partially Paid` and reversal already
re-opens the invoice.

### How it was tested

End to end in a browser against a stub gateway that accepts the push, hands
back a CheckoutRequestID and posts the callback — so the real path runs: push,
prompt screen, callback, balance, activation. 24 checks on the member's path,
3 on the no-`Amount` callback, 7 on the gym's switch. All passed.

## 12 · Expenses, and a dashboard whose filters are real

```bash
cd /root/fit-generations-gym
git apply --check /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0010-expenses-and-dashboard.patch \
  && git apply /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0010-expenses-and-dashboard.patch
docker compose -f docker-compose.behind-proxy.yml up -d --build
```

Goes on after 0009. No migration — the new expense fields are keys in the
JSON document the app already stores, and a row written before this patch
still reads back fine.

### Expenses

Expenses existed only as a side effect. Settling a service charge wrote one,
and nothing else ever did — so the income-vs-expense chart on the dashboard
was drawing the cost of *collecting* money and calling it the cost of
**running a gym**. Rent, wages, power and repairs were nowhere in it.

There is now a section for them, under **Money → Expenses**:

- Record a spend with a date, category, who it was paid to, how, and a note.
- Search and filter the list; edit or delete a row.
- A breakdown of where the month's money went, as a share of the total.
- Money in, money out and what is left over at the top of the same screen, so
  the margin is read off one page instead of assembled in someone's head.

**Rows marked Automatic** are service charges the system booked when they
were settled. They are shown and counted but cannot be edited or deleted
here; undoing the charge under Payments & Billing is what takes one back.
Deleting it by hand would leave a charge marked paid with nothing behind it.

Those rows now carry the charge's own id. Undo used to find the expense by
matching month + amount + category, which picks the wrong row the moment a
gym has two charges of the same size in one month. Older rows have no id
stamped on them, so the old match is kept as a fallback for those alone.

Access: a new **Expenses** module in the permission picker. Admins and
accountants get it by default; trainers do not.

### The dashboard

The period chips were `<span>` elements styled to look like dropdowns —
chevron and all — sitting over figures that were always all-time. Four of
them. One real control replaces the lot, and the choice lives in the URL, so
the server recomputes, a reload keeps the period, and the view can be sent to
someone as a link.

- **The money line is now first**: in, out, left over, still owed. It is the
  question the screen gets opened to answer.
- **Still owed is deliberately not period-filtered.** An invoice raised in
  March and still unpaid is owed today; hiding it when someone looks at April
  is how a debt gets forgotten.
- **Each tile is a way in** — money out opens the expenses list for that
  month, money in opens billing.
- **Headcounts stay unfiltered and say "Now".** How many members the gym has
  is a fact about today, not about March.

One more thing found in there: the income-expense chart's months were the
literal list `2026-01` … `2026-07`. That draws the right picture for seven
months and an empty chart for ever afterwards — the sort of thing nobody
notices until the year turns. The window now follows the selected period.

### How it was tested

In a browser: 17 checks on the expenses section — record, edit, delete,
search, filter, the breakdown, the period control — and 14 on the dashboard,
including setting a gateway rate, settling a service charge, confirming it
books an Automatic row, and undoing it to confirm the row goes with it. The
part-payment and member-area suites were re-run and stayed clean.

## 13 · The frozen member portal

```bash
cd /root/fit-generations-gym
git apply --check /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0011-portal-stale-session.patch \
  && git apply /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0011-portal-stale-session.patch
docker compose -f docker-compose.behind-proxy.yml up -d --build
```

Goes on after 0010.

### What was actually wrong

The reported symptom was exact: the **Members area** screen, with *Create an
account* and *Sign in* both appearing to load and going nowhere, and only a
private window working. It is not the sign-in flow. It is two guards asking
two different questions:

- `/portal` renders that screen when the session does not resolve to a member
  **record**.
- `/portal/login` and `/portal/signup` redirected back to `/portal` whenever
  the **cookie** said `member` — without checking that member still existed.

Delete a member from the office, or restore a database from before they
joined, and their browser keeps presenting a perfectly valid, correctly
signed session for an id that resolves to nobody. From then on `/portal` sent
them to the join screen, and the join screen's two buttons sent them straight
back. The page loaded every time and never changed. The header offered no
sign-out, because it only renders one for a *resolved* member — so nothing on
the page could clear the cookie. A private window worked because it had no
cookie to present.

Note what this is **not**: it is not a cache, not a build, and not a bad
`AUTH_SECRET`. An invalid or expired cookie fails verification, and then the
sign-in page renders normally. It takes a *valid* session for a deleted
account to produce the loop — which is why repeated sign-in/sign-out testing
never reproduced it.

### The fix

`currentMember()` answers one question — who is signed in, resolved all the
way to the record — and every portal page asks it, so they cannot disagree.
Then:

- The landing screen **says what happened** instead of silently showing the
  join page to somebody who believes they are signed in, and carries a
  **Sign out**.
- The header offers Sign out whenever a session is present but unresolved, so
  this class of trap cannot recur on any portal page.
- The invoice page checks the record too. Deleting a member leaves their
  invoices behind, and a session that outlived the account was still opening
  them.

### If a member reports it on the live site

They can now fix it themselves from the page. Before this patch goes on, the
manual escape is to clear the site's cookies for fitgenerationsgym.com (or
use a private window). To see whether a given session is stranded:

```bash
docker exec fitgen-db psql -U fitgen -d fitgen -tA -c \
"select count(*) from users where data->>'role' = 'member';"
```

A member who insists they had an account, with no row for their email, is
this bug. Deleting members from **Members & Staff** is what strands anyone
signed in as them.

### How it was tested

Reproduced first: sign up a member, delete the record from the office, then
click both buttons in the member's browser. Before — both returned to the
same screen and there were **zero** ways to sign out. After — both reach real
forms, the screen explains itself, and signing out works. The member-area,
part-payment, expenses and dashboard suites were re-run and stayed clean.

## 14 · The website quotes the prices the gym actually charges

```bash
cd /root/fit-generations-gym
git apply --check /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0012-pricing-from-the-catalog.patch \
  && git apply /srv/smp-portfolio/repo/deploy/contabo/fitgen/patches/0012-pricing-from-the-catalog.patch
docker compose -f docker-compose.behind-proxy.yml up -d --build
```

Goes on after 0011. No migration — it changes where the public pages read
from, not what is stored.

### What was wrong

`/pricing` and the homepage rendered `planTiers`, a list in the source code.
**Membership Plans** in the office edits `billablePlans`, which is what
`assignPlan` prices an invoice from. Nothing connected them.

So a price changed in the office never reached the website, and the figure a
member was **billed** could differ from the figure that **persuaded them to
join** — with no warning on either screen, because neither knew the other
existed. The only way the website's prices ever changed was a code deploy.

### What it does now

Every number on the public pages comes from the catalog. The words around
them — headline, subtitle, perks, which card is highlighted — are editorial,
have no admin screen, and stay in code.

Three things that follow from doing it properly:

- **The savings are arithmetic, not copy.** "Save KSh 1,000" was typed into
  the source and stops being true the moment somebody edits a price. An
  untrue saving on a pricing page is worse than no saving at all. It is now
  the monthly price × the months, less the plan price, and it moves when
  prices move. (It reproduces the old copy exactly at today's prices, and
  gives the yearly plan a real figure instead of "Best value".)
- **The FAQ quoted four prices of its own** in prose — a joining fee, two
  drop-in rates and a corporate rate. Prices in the answers that disagree
  with the cards above them are the same bug in a smaller box. They come from
  the catalog too, and a question the catalog cannot answer is not asked.
- **The registration fee is read off the plans that charge it.** It is
  charged per plan, so when they disagree the honest answer is the lowest,
  said as "from"; and when nothing charges one, the band disappears rather
  than advertising a fee no invoice will contain.

**Deactivating a plan now takes it off the website**, which is what "active"
always looked like it meant. A tier with nothing active stops being shown,
and a tier invented in the office appears on its own.

### One operational change

`/` and `/pricing` are now rendered per request rather than prerendered.
They have to be: the store is only loaded at boot, so a static build cannot
read it — the build fails outright — and a prerendered page would bake
today's prices in until the next deploy. Both are light pages and the box
has the headroom, but it is a real change to how they are served.

### How it was tested

Change the Members monthly price and registration fee in the office, then
read the site in a **fresh browser with no session**, the way a member of the
public arrives. The cards, the headline "from" price, the derived savings,
the registration band, the FAQ prose, the homepage, and the invoice a member
is actually raised all move together — 15 checks. Deactivating and
reactivating the plan was checked the same way. The other five suites were
re-run and stayed clean.

To spot-check on the box after deploying, change a price under Membership
Plans and reload `https://fitgenerationsgym.com/pricing` in a private window.

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

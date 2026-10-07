# 64theatre on the Contabo box

Live at **https://tickets.64theatre.art** — see "The domain" below for the
subdomain layout and the switch-over, which must be done DNS-first.

Before the domain existed this ran on `sslip.io` free wildcard DNS, which maps
any IP to a hostname and gets a genuine Let's Encrypt certificate with no
registrar at all:

```
https://64theatre.169-58-127-122.sslip.io
```

That is still the right answer for the next app that has no domain yet — real
certificate, stable URL, no tunnel, so the PWA, the offline gate scanner and
add-to-home-screen all behave as they will in production.

**Shape:** one container (nginx + PHP-FPM), SQLite on a volume, demo content
seeded on boot, fake payment gateway. **~250 MB RAM**, capped at 512 MB. No
Postgres, no Redis, no worker — the staging config runs jobs inline.

---

## Deploy

```bash
mkdir -p /srv/64theatre
git clone --depth 1 https://github.com/simboni/64theatre-platform /srv/64theatre/repo

cd /srv/smp-portfolio/repo && git pull
cp deploy/contabo/64theatre/compose.yml deploy/contabo/64theatre/env.example /srv/64theatre/

cd /srv/64theatre
cp env.example .env && chmod 600 .env
```

Set a real `APP_KEY` **before** building — compose validates it even for a
build, and Laravel's key is just `base64:` plus 32 random bytes, so no image
is needed to make one:

```bash
sed -i "s|^APP_KEY=.*|APP_KEY=base64:$(openssl rand -base64 32)|" /srv/64theatre/.env
grep -c '^APP_KEY=base64:' /srv/64theatre/.env    # must print 1
```

Then build:

```bash
docker compose -f /srv/64theatre/compose.yml build
```

`APP_URL` in `env.example` is already `https://tickets.64theatre.art`. It must
match the Caddy hostname exactly — https, no trailing slash. Start it:

```bash
docker compose -f /srv/64theatre/compose.yml up -d
docker compose -f /srv/64theatre/compose.yml logs -f app   # ctrl-C once booted
```

Confirm nothing else moved:

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
```

## Verify before touching anything shared

```bash
docker exec edge-caddy wget -qO- http://64theatre:8080/up
```

`/up` is Laravel's health endpoint — it should return a short HTML page.

## Publish

The domain exists now, so publish the real hostname — `tickets.caddy` in this
directory, and **point the DNS first**. The full sequence is under "The domain"
below; do not skip the `dig` check.

```bash
cp /srv/smp-portfolio/repo/deploy/contabo/64theatre/tickets.caddy \
   /srv/edge/sites/64theatre.caddy
docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile
```

Only on `Valid configuration`:

```bash
docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
curl -sI https://tickets.64theatre.art/ | head -3
```

For an app with no domain yet, an `sslip.io` name needs no DNS work at all —
`<name>.169-58-127-122.sslip.io` already resolves to this box.

The admin login comes from the demo seeder; `ADMIN-GUIDE.md` in the app repo has
the credentials and the walkthrough to hand the client.

---

## The domain — tickets.64theatre.art

The domain is `64theatre.art`, and ticketing lives on **`tickets.64theatre.art`**,
not the apex. Streaming and film are coming and will not be this application;
keeping ticketing on its own subdomain means the public site can be built,
moved or replaced later without touching a system that is taking money.

| Host | Serves |
|---|---|
| `tickets.64theatre.art` | this app — ticketing, orders, box office, admin |
| `64theatre.art`, `www.` | the public site (not deployed yet) |
| `watch.` / `stream.` | streaming (later) |

### 1. DNS first — this order matters

```
A   tickets   169.58.127.122
```

Then wait for it, and do not skip this:

```bash
dig +short tickets.64theatre.art      # must print 169.58.127.122
```

Caddy asks Let's Encrypt for a certificate the instant the config loads, and
Let's Encrypt rate-limits **failed** validations. Reload before the record
resolves and you are locked out of retrying for hours — which is exactly what
happened to `stackup.co.ke`.

### 2. Point the app at it

In `/srv/64theatre/.env`:

```env
APP_URL=https://tickets.64theatre.art
```

```bash
docker compose -f /srv/64theatre/compose.yml up -d
```

> **What this does and does not affect.** `APP_URL` builds the absolute links
> in ticket emails (`route('orders.print', …)`) and the `callback_url` sent to
> the payment gateway. It does **not** appear in ticket QR codes: the payload
> is `64T1.<uuid>.<performance-id>.<expires>.<sig>`, an opaque signed string
> with no URL in it (`app/Services/TicketQr.php`). Tickets already issued keep
> scanning after the move. An earlier version of this README claimed otherwise.

### 3. Publish the hostname

```bash
cp /srv/smp-portfolio/repo/deploy/contabo/64theatre/tickets.caddy \
   /srv/edge/sites/64theatre.caddy
docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile \
  && docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
```

Validate first — an invalid config applies nothing. Reload, never `restart`:
restarting edge-caddy drops every site on the box at once.

Watch the certificate arrive:

```bash
docker logs -f edge-caddy        # "certificate obtained successfully"
curl -sI https://tickets.64theatre.art/ | head -3
```

### 4. Re-point anything that calls back

Anything holding the old sslip.io URL now points nowhere useful:

- **Kopo Kopo dashboard** → webhook `https://tickets.64theatre.art/webhooks/kopokopo`
- **Pesapal**, if used → the IPN is registered through the API, so re-register it
- `BRAND_WEBSITE` in `.env` → the **public site**, not this host. A ticket
  should send someone to `64theatre.art`, not back to the box office. Leave it
  blank until that site exists; blank prints nothing.

### Optional: catch the apex before the main site exists

Until `64theatre.art` has a site, someone typing it gets nothing. If you would
rather send them to the box office, add a **separate** file — never edit the
ticketing one:

```bash
cat > /srv/edge/sites/64theatre-apex.caddy <<'EOF'
64theatre.art, www.64theatre.art {
	redir https://tickets.64theatre.art{uri} 302
}
EOF
```

`302`, not `301`: a permanent redirect is cached by browsers and would fight
you the day the real site goes up. Both names need `A` records first, and
delete the file when the public site is ready.

## Admin patches

Applied in order, against a clean checkout of `simboni/64theatre-platform`:

```bash
cd /srv/64theatre/repo
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0001-event-centred-admin.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0002-venue-create-inline.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0003-kopokopo-and-offline-payment.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0004-admin-ticket-authority.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0005-payment-methods-admin.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0006-payment-waiting-feedback.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0007-prices-on-the-event-screen.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0008-seamless-checkout.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0009-door-menu-and-verify.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0010-gate-mpesa-prompt.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0011-delete-a-ticket.patch
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/patches/0012-delete-an-event.patch
cd /srv/64theatre && docker compose up -d --build
```

`0005` adds a table, so it needs its migration — the container runs
`migrate` on boot, so `up -d --build` is enough.

| Patch | What it does |
|---|---|
| `0001-event-centred-admin` | One-step event creation: a three-step wizard that takes performances and ticket prices with the event, performance names instead of row ids, and ticket categories edited from inside the performance |
| `0002-venue-create-inline` | Add and correct venues from the venue dropdown itself |
| `0003-kopokopo-and-offline-payment` | M-Pesa via Kopo Kopo, so tickets sell before the Safaricom paybill exists; plus Pay Bill details for buyers whose prompt never arrives |
| `0004-admin-ticket-authority` | A Tickets screen (there was none), void/reinstate, email + WhatsApp resend, and a payment-method choice when marking an order paid |
| `0005-payment-methods-admin` | **Sales → Payment methods**: switch online payments and the Pay Bill panel on or off, and choose the provider, without a deploy |
| `0006-payment-waiting-feedback` | A spinner while the STK prompt is sent, a locked Pay button, and a live waiting state on the order page |
| `0007-prices-on-the-event-screen` | Ticket categories and prices editable from **Edit event**, which previously had no route to an amount |
| `0008-seamless-checkout` | Three-step checkout, a canonical phone number, resuming an unpaid order instead of duplicating it, and a ticket that does not break on a phone |
| `0009-door-menu-and-verify` | A **Door** menu reaching the scanner and box office, plus verifying a ticket from the office |
| `0010-gate-mpesa-prompt` | The box office can push an M-Pesa prompt to a walk-up customer's phone instead of only taking cash |
| `0011-delete-a-ticket` | Deleting a ticket, singly or in bulk, returning the seat to stock and refusing anything already scanned |
| `0012-delete-an-event` | Deleting an event: says why it is blocked instead of erroring, offers Cancel, and can erase demo shows outright |

`0002` fixes a **go-live blocker**, not a convenience. Venues are created only
inside `demoSeason()` in `database/seeders/DatabaseSeeder.php`, which runs
under `local` and `staging` and *not* under `production` — and no admin screen
creates one. Switching to `APP_ENV=production` (the first line of the section
below) therefore leaves zero venues and no way to add any; since a performance
requires a venue, no event can be created at all. Verified by migrating and
seeding a fresh database with `APP_ENV=production`: **0 venues**.

The staging box hides this completely, because the demo season has already
planted three.

## Setting prices

**Events → edit an event → Performances → Add / edit a performance.** Venue,
times, status and **Tickets & prices** are one form.

`0001` put prices in the creation wizard, but editing afterwards was a dead
end: prices live on `TicketTypesRelationManager`, which hangs off the
Performances resource, and that resource is hidden from navigation. From Edit
event there was no route to an amount at all — a performance could be
scheduled with nothing on sale and no way to fix it without a URL typed by
hand.

Prices are entered in **shillings** and stored as integer cents. The form field
`price_kes` exists only in the form: a fill hook divides on load, create and
save hooks multiply back and drop the display field before it reaches the
model. Verified both directions, including 250.50 → 25050 → 250.5.

## What the admin can do with tickets

Before `0004` the admin had **no Tickets screen at all**. Tickets were created
by a paid order or a printed batch, emailed, and then invisible: "has this
person actually got a ticket?", "has this code been used?" and "that one is a
duplicate, kill it" had no answer anywhere in the office. The gate app could
scan a code; nobody could look one up.

**Sales → Tickets** now lists every issued ticket, searchable by short code,
holder name or phone — including from the global search bar, so a code read
over the phone goes straight to the ticket.

| Need | Where |
|---|---|
| Find a ticket by its code | Sales → Tickets, or the search bar |
| See whether it has been used | `status` column; `redeemed` means it went through the gate |
| Show the QR again at the counter | Open the ticket — it renders the live signed QR |
| Kill a duplicate or leaked code | **Void** (reason required, audited) |
| Undo that | **Reinstate** — not offered for a redeemed ticket, which has already walked through the door |
| Re-send tickets by email | Orders → **Email tickets**; the address is saved to the customer |
| Send by WhatsApp | Orders or Tickets → **WhatsApp** |
| Record a payment taken outside M-Pesa | Orders → **Mark paid**, now with a method and reference |

**Generating** tickets is **Sales → Ticket batches** — `BoxOffice::createBatch()`
pre-prints gate stock against a ticket type's inventory. Tickets are
deliberately not created from the Tickets screen: both real routes hold
inventory against the ticket type, and minting one by hand would oversell the
house.

### Deleting an event

Deleting an event that had sold anything failed with **"error while loading
page"** — true, useless, and indistinguishable from the app being broken.

The cause is the schema, and it is correct. `performances.event_id` and
`ticket_types.performance_id` cascade, but `orders.performance_id`,
`tickets.performance_id` and `checkins.performance_id` do **not** — a show
people paid for should not vanish because somebody clicked the wrong row. The
database refuses with `SQLSTATE[23000] FOREIGN KEY constraint failed`, and
nothing turned that into a sentence.

**Edit event** now offers whichever applies:

| | |
|---|---|
| **Delete** | Only when nothing is sold. Performances and ticket types cascade. |
| **Delete** (greyed) | Explains what is in the way — "This event has 4 orders (2 paid), 2 issued tickets, 1 check-in." |
| **Cancel event** | The right answer for a real show that is not happening: off the website, history kept, refunds still reconcilable. |
| **Erase event and all sales** | Super admin only. Deletes orders, payments, ledger entries and tickets in dependency order. |

The erase action requires the event title to be typed, and says plainly that
money taken through M-Pesa is **not** refunded by it and cannot be reconciled
once the records are gone. It is for demo data, not for a show that sold real
tickets.

Verified both: a clean event deleted with its cascades (performances 7 → 6,
types 16 → 13), and a blocked one purged 1 check-in, 2 tickets, 4 ledger
entries, 3 payments, 4 order items and 4 orders before removing itself.

### Deleting a ticket

Super admin only, on **Sales → Tickets**, singly or by selecting several.

**Void and delete are different things and the difference matters.** Void keeps
the record and stops the ticket working — that is what a real sold ticket
needs. Delete erases it, and is right for a test sale or something created by
mistake.

Two things delete has to get right, which is why it was not simply a button:

- **The seat goes back on sale.** `quantity_sold` is incremented when a ticket
  is sold and nothing decrements it on delete, so a naive delete would leave
  the seat counted as sold for ever — the house reading full with an empty
  chair. Verified: `quantity_sold` 5 → 4, remaining 245 → 246.
- **A scanned ticket is refused.** `checkins.ticket_id` is a constrained
  foreign key, so deleting a ticket somebody came in on fails at the database
  with an integrity-constraint error. Confirmed by scanning a ticket and trying:
  `SQLSTATE[23000] FOREIGN KEY constraint failed`. It is also evidence that a
  person walked through the door. The action checks first and says so, and the
  bulk action skips them and reports how many.

Every delete is written to the audit log with the short code.

### Sending tickets

Email is the default and goes automatically on payment — but only when the
buyer has an email address, and a box-office or Pay Bill buyer often has none.
**Email tickets** takes an address at the counter and saves it to the customer,
so it is typed once.

**WhatsApp** opens the buyer's chat in the operator's own WhatsApp with the
message ready to send. A server-side send would need the WhatsApp Business API,
an approved template and a per-message fee; this costs nothing and arrives from
a number the customer recognises. The button is hidden when the stored number
is not a Kenyan mobile, because `wa.me` opens an empty chooser for a malformed
number and that looks like it worked.

What is shared is the buyer's own order page — the same unguessable URL the
confirmation SMS already sends, carrying the QR codes and the print view. It is
the whole ticket, not a pointer to one.

### Payment method

**Mark paid** previously recorded every manual payment as `bank_transfer`,
whatever had actually happened. It now asks for the method (M-Pesa, cash, bank
transfer, card) and a reference — the M-Pesa code, bank reference or receipt
number — both of which go to the ledger and the audit log. A blank reference
generates one prefixed `MANUAL-`, so it can never be mistaken for something a
gateway returned.

## Payment methods, from the admin

**Sales → Payment methods**, super admin only, every change audited with its
previous value.

- **Accept payments online** — off refuses checkout before an order is
  created, so switching payments off during an outage does not strand seats in
  unpaid orders that only release when they expire.
- **Provider** — Kopo Kopo, Pesapal or Daraja. The page refuses a provider
  whose credentials are missing, and says so, rather than letting a buyer find
  out. It also warns when the chosen provider is pointed at its sandbox, where
  payments look successful and no money moves.
- **Show Pay Bill details** — the buyer-facing offline panel.

Credentials are **not** editable here and never will be. A form that could
change where money settles turns a stolen admin session into a theft, so the
provider can be chosen in the browser but only configured in `.env`.

`fake` is not offered either. It confirms orders and issues real tickets for
nothing — indispensable in testing, catastrophic in production, and a dropdown
is exactly how it would get picked by accident. It stays reachable through
`PAYMENT_GATEWAY` in `.env`, where choosing it takes deliberate effort.

And since this is now selectable, an unset or misspelled value no longer falls
through to the fake gateway in silence: **in production it throws.** A broken
checkout is bad; a silently free one is worse, and would not be noticed until
the takings were counted.

## Taking money before the Safaricom paybill exists

`0003` adds Kopo Kopo, an M-Pesa aggregator. It sells through Kopo Kopo's own
till and settles to the client's account, so tickets can go on sale now rather
than after Safaricom approves a paybill in 64 Theatre's name — which takes
weeks. Switch `PAYMENT_GATEWAY=daraja` when it lands; nothing else in the
application changes, which is what the `PaymentGateway` interface is for.

```env
PAYMENT_GATEWAY=kopokopo
KOPOKOPO_BASE_URL=https://api.kopokopo.com   # sandbox.kopokopo.com while testing
KOPOKOPO_CLIENT_ID=...
KOPOKOPO_CLIENT_SECRET=...
KOPOKOPO_API_KEY=...                         # signs webhooks — NOT the client secret
KOPOKOPO_TILL_NUMBER=...
```

Set the webhook in the Kopo Kopo dashboard to `https://<host>/webhooks/kopokopo`.
It is verified by HMAC-SHA256 over the raw body using `KOPOKOPO_API_KEY`; an
unsigned or forged request gets a 401 and is never acted on.

Three things that bite:

- Success from the STK call is **201 with the handle in the `Location`
  header**, not in the body.
- `KOPOKOPO_API_KEY` is a **different secret** from the client secret. Swapping
  them authenticates fine and then fails every single callback.
- Live keys against the sandbox URL fail authentication, and the error does not
  say why.

Payments are stored with `gateway = 'aggregator'`, the value Pesapal already
uses, because that column is an enum and adding a value would mean an enum
migration — which on SQLite rebuilds the table holding live payment records.
The provider is recorded in `gateway_payload.provider`.

### Paying by hand

The STK prompt does not always arrive. The order page now also shows:

```
Pay Bill  →  Business number 542542 (I&M Bank)
             Account number  064064
```

Change them with `OFFLINE_PAYMENT_PAYBILL` / `_ACCOUNT` / `_BANK`, or hide the
panel with `OFFLINE_PAYMENT_ENABLED=false`.

**This is not reconciled automatically**, and the page says so to the buyer.
The account number identifies 64 Theatre to Kopo Kopo — it is not per-order, so
there is nowhere to put a reference. The buyer is told to keep the M-Pesa
confirmation SMS and quote their order number at the box office. Budget for
someone matching those by hand, or keep the panel off until you have a process
for it.

## The door

The scanner, box office and door stats have always existed, at `/gate`,
`/gate/sell` and `/gate/stats` — but **nothing in the admin linked to them**.
They were reachable only by knowing the URL, so somebody who saw the scanner
once had no way back to it.

A **Door** group now carries all three, opening in a new tab because the door
is worked alongside the office rather than instead of it.

| | |
|---|---|
| **Verify a ticket** | In the admin — look a code up without spending it |
| **Scanner** | `/gate` — the phone-at-the-door QR scanner |
| **Box office** | `/gate/sell` — selling printed stock and new tickets |
| **Door stats** | `/gate/stats` — what has come through |

### Selling at the gate

**Door → Box office → Sell new e-ticket (walk-up)** now asks how the customer
is paying:

- **M-Pesa** — pushes the STK prompt to their handset and waits
- **Cash** — unchanged: taken at the desk, tickets issued immediately

Before this the box office could only take cash. `sellNew` hardcoded
`'gateway' => 'cash'` and confirmed the order on the spot, so a walk-up who
wanted to pay by phone had to be sent to the website.

**The operator never marks an M-Pesa sale paid.** The order stays
`awaiting_payment` with zero tickets until the Kopo Kopo webhook says the money
arrived. That is deliberate: a button the operator can press to issue a ticket
is a button that lets people in for free, and at a busy door nobody is checking
whether the payment really completed.

The screen shows a live "Waiting for payment — KES X" panel naming the number
the prompt went to, polling the same `orders.status` endpoint the buyer's own
page uses, so there is one definition of paid. When the money lands the panel
turns green and offers **Print tickets**.

If the prompt cannot be sent at all, it says so and tells the operator to take
cash and record it as cash — rather than leaving them staring at a screen that
will never change.

### Verifying from the office

The scanner is the right tool at the door. **Door → Verify a ticket** is for
the other half of the job: a code read out over the phone, a printed list to
settle, or an argument about whether a ticket has already been used.

Choose the performance, type the eight characters under the QR, and it answers
one of:

| | |
|---|---|
| **Valid — admit** | Issued, for this performance, unused |
| **Already used** | With the time it went through the gate |
| **Wrong performance** | Naming the night it is actually for |
| **Void** / **Refunded** | Killed, or money returned |
| **No such ticket** | Nothing matches that code |

**Checking never spends the ticket.** Admitting is a separate, confirmed
button that appears only after a check says the ticket is good. That
separation is the point: the common case is answering a question, and a lookup
that silently redeemed would turn every enquiry into a used ticket and a row at
the door. Admitting goes through the same `GateCheckin` service the scanner
uses, so duplicates are caught and audited identically.

## Buying a ticket

Checkout is three steps: **Tickets → Details → Confirm and pay**. It was one
screen carrying every ticket category, four form fields and a Pay button at
once. Stepping it is only about how much is visible — the form posts exactly as
before, and with JavaScript off every step is revealed, so it degrades to the
single long form it used to be.

Only two fields are required: the M-Pesa number the prompt goes to, and the
email the tickets go to. Name and promo code sit behind a disclosure, because
most buyers have neither and every visible field is another reason to stop. The
last screen has nothing to fill in — before money moves, a screen should be
read, not worked through.

### Paying twice

A buyer who started paying, lost the page and came back used to create a second
order and a second STK prompt. If the first one then completed, they paid twice
for the same show.

Now, before an order is created, an unexpired unpaid order for the same phone
and the same performance sends them back to the one they already have. Scoped
to the performance, because buying for a different night is genuinely a new
order.

That only works because the phone number is now canonical.

### One buyer, one phone number

`Customer::firstOrCreate(['phone' => …])` stored the number exactly as typed,
so `0712345678`, `+254712345678` and `254 712 345 678` were **three different
customers** for one person — tickets split between them, "My tickets" finding
only one, and no reliable way to ask whether a buyer already had an order.

`App\Support\Phone` normalises to `2547XXXXXXXX` at both customer-creating
sites and in the lookup. Verified across six input formats.

### Accounts

There are none, and there should not be. The phone number is the identity, it
is the thing M-Pesa confirms against, and an account is friction in front of a
purchase. A returning buyer uses **My tickets** with their phone number.

> **One thing to decide.** That lookup takes a phone number and returns the
> orders and ticket short codes for it; the ticket code is optional. A short
> code is what admits someone at the gate, so anyone who knows a buyer's phone
> number can read their tickets. Requiring the code, or sending a one-time
> code, would close it. Flagged rather than changed, because requiring the code
> also means a buyer who lost it cannot self-serve.

### The ticket on a phone

The ticket was built as a 1fr + 208px stub. At 360px the stub took more than
half the width, and the masthead's absolutely positioned "ADMIT ONE" band and
language badge printed straight over the event title.

It now stacks below 560px: title full width, facts wrapped, stub underneath,
QR up from 118px to **190px** — easier to scan off a screen, which is how most
people will present it. Verified at 360px in a real browser: zero horizontal
overflow, title 312px wide, stub below the body, nothing overlapping.

## While the buyer waits

Reaching Kopo Kopo and Safaricom takes a few seconds, and until the prompt
lands on the handset the page looks like nothing happened. `0006` fills that
silence:

- The **Pay button locks on submit** and becomes a spinner reading "Sending
  prompt to your phone…". That also closes a real bug: nothing prevented a
  second press, and two presses created two orders, held two sets of seats and
  sent two STK prompts.
- The **order page shows a pulsing "Waiting for your payment…"** naming the
  number the prompt went to, and says the page updates on its own — it already
  polled and reloaded itself, but silently, so a buyer who had already paid sat
  looking at a still screen wondering whether to pay again.
- After **25 seconds** a second line offers the Pay Bill fallback. Delayed on
  purpose: shown immediately it reads as "this is broken" before the prompt has
  had a fair chance to arrive.

Both respect `prefers-reduced-motion`.

## Email (Brevo)

`compose.yml` shipped with `MAIL_MAILER: log` hardcoded, which writes ticket
emails to the container log and delivers them to **nobody** — the job runs,
the mail "sends", the buyer gets nothing. That is fine for a demo and a silent
failure the moment real tickets are sold.

In `/srv/64theatre/.env`:

```env
MAIL_MAILER=smtp
MAIL_HOST=smtp-relay.brevo.com
MAIL_PORT=587
MAIL_SCHEME=smtp
MAIL_USERNAME=<Brevo SMTP login>
MAIL_PASSWORD=<Brevo SMTP key, xsmtpsib-…>
MAIL_FROM_ADDRESS=tickets@64theatre.art
MAIL_FROM_NAME=64theatre
```

```bash
docker compose -f /srv/64theatre/compose.yml up -d
```

Three things that bite:

- **`MAIL_SCHEME`, not `MAIL_ENCRYPTION`.** Laravel 13 renamed it
  (`config/mail.php:42`). The old name is read by nothing and fails silently.
  `smtp` on port 587 negotiates STARTTLS; port 465 needs `smtps`.
- **The SMTP key is not the API key.** Brevo's SMTP key is `xsmtpsib-…`; the
  API v3 key is `xkeysib-…` and will not authenticate over SMTP.
- **`MAIL_FROM_ADDRESS` must be a sender Brevo has authenticated** for the
  domain, or Brevo rejects the message outright.

### Test it before a customer does

```bash
docker compose -f /srv/64theatre/compose.yml exec app php artisan tinker --execute='
Illuminate\Support\Facades\Mail::raw("64theatre SMTP test", function ($m) {
    $m->to("you@example.com")->subject("64theatre — SMTP test");
});
echo "sent via ", config("mail.default"), " as ", config("mail.from.address"), PHP_EOL;'
```

An authentication failure throws immediately and names the reason. Silence
plus a delivered email means it works.

### The daily cap

Brevo's free plan allows **300 emails a day across the whole account**. If
64 Theatre shares an account with another product, they share that ceiling,
and Brevo stops sending rather than queueing — a buyer simply gets no ticket.
A show selling a few hundred tickets wants either its own account or a paid
plan.

## Upgrading to production

Apply `0002` **before** this section, or the first thing a production install
does is refuse to create an event.

The demo config is deliberately not the live config. For real ticket sales the
repo's `DEPLOY.md` calls for:

- `APP_ENV=production`, a **fresh** `APP_KEY`, `SEED_ON_BOOT=false`
- `PAYMENT_GATEWAY=daraja` with production `DARAJA_*` credentials
- **PostgreSQL** instead of SQLite (`DB_CONNECTION=pgsql` + a `db` service)
- **Redis** + `QUEUE_CONNECTION=redis` and a **worker container**
  (`php artisan queue:work`)
- Real `MAIL_*` and `SMS_ENABLED=true` for ticket delivery
- Nightly database backups

Ask me when you reach that point and I'll extend this compose file — it's an
additive change, and the SQLite data can be migrated across.

## Safety

- No host ports. `edge-caddy` keeps 80/443.
- Its own compose project, volume and image — it cannot touch smpcredits,
  riziki, fitgen, cosdep, talithakum, stackup or the portfolio.
- `mem_limit: 512m`, so a runaway process can't starve the box.
- Always use `-f /srv/64theatre/compose.yml` so a command can never act on
  another project.

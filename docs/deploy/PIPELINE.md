# What's next, and what it took to find out

Written 13 Oct 2026. The point of this file is that the state below cost real
time to establish — channel ids, a PENDING wallet, which app lives where —
and none of it is obvious from the code.

---

## 1 · Test paybills (tomorrow)

**Goal:** get the client's own business name onto the M-Pesa prompt instead of
`GLOBE GAIN PIPSPRO`.

What is established:

- The prompt name is **not** settable per request. The PayHero payload is
  `amount`, `phone_number`, `channel_id`, `provider`, `external_reference`,
  `customer_name`, `callback_url` — and `customer_name` is the *buyer's*. The
  name comes from how the **channel** is registered.
- The three channels registered today are **bank accounts**, so the collecting
  paybill is the bank's and the registered name is somebody else's.
- PayHero's marketing says a paybill you own can carry your business name.
  Their API docs do not document it. Unconfirmed — ask before spending on it.

| Channel | Type | Account | Bank | Used by |
|---|---|---|---|---|
| 13962 | bank | 01704438696350 | — | 64theatre |
| 14002 | bank | 0480186424734 | Equity | Fit Generations |
| 13928 | bank | 01006891716150 | I&M | unused |

`13094` is the PayHero **account id**, not a channel. It was briefly set as
`PAYHERO_CHANNEL_ID` and matched nothing.

**SETTLED 14 Oct — the name is the INITIATOR, not the account holder.**
A one-shilling prompt against channel 13928 (the I&M account known to be
Peter's, from a loan disbursement) showed `GLOBE GAIN PIPSPRO`, exactly as
13962 did. Two accounts, two banks, same name. So:

- All three channels are genuinely his (`account_id: 13094`), and the money
  settles where it should — `inbound_payment` rows confirm it.
- PayHero raises every prompt under that entity's Safaricom shortcode.
- Pointing at a different bank account will NEVER change the name. Only
  initiating on a shortcode registered to the client will.

So the question to put to PayHero is narrow: *can prompts be initiated on OUR
shortcode?* A paybill we own that they still push through theirs buys nothing.

**The bigger door this opens.** A paybill with a passkey makes PayHero
optional. Both apps already have complete Daraja support, written before any
of this work:

- Fit Generations — `src/lib/services/mpesa.ts`, select with
  `PAYMENTS_PROVIDER=daraja`
- 64theatre — `MpesaStkGateway`, select in the admin's Payment Methods

Own paybill means own name on the prompt, no shared service wallet, no
aggregator fee, and no third party in the customer relationship. The provider
facade makes it configuration, not code.

```bash
ENV_FILE=/path/to/.env CALLBACK_URL=https://… \
  bash deploy/contabo/64theatre/payhero-check.sh 07XXXXXXXX 1
```

**On the PENDING service wallet — I overstated this.** It reads `KES 100`
with status `PENDING`, but payments went through on it and the `service_charge`
rows show `cost: 0`, so it is neither blocking nor draining. Worth asking
about, not a blocker. The earlier "most likely cause of slow prompts" claim
was not supported by the evidence.

---

## 2 · The admin sidebar

`src/components/admin/sidebar.tsx` renders `adminNav` from
`src/lib/admin.ts` — **fourteen flat links** on an ember gradient. Nothing is
grouped, so everything competes equally and the eye has nowhere to land. That
is the "traditional" feel, and it is structure rather than styling.

Proposed grouping, which is most of the fix:

| Group | Items |
|---|---|
| Overview | Dashboard · Reports · Notifications |
| People | Members & Staff · Attendance · Reservations |
| Money | Membership Plans · Payments & Billing · Store |
| Training | Class Schedule · Workout Plans · Nutrition Plans · Calculators |
| System | System Settings |

Then: section labels, a collapsed rail on narrow screens, the active item
carrying real weight, and counts against the few that earn one (unread
notifications, overdue invoices). Keep the lime→ember brand strip.

The same shell drives the mobile menu in `shell.tsx`, so both change together.

---

## 3 · Email through Brevo

**64theatre has never sent a ticket by email.** `MAIL_MAILER` is `log`, so
mail is written to a file. Before switching it on, the credential has to work:

```bash
bash deploy/contabo/64theatre/mail-check.sh            # diagnose
bash deploy/contabo/64theatre/mail-check.sh you@…      # send a test
```

The last failure was `535 Authentication failed`, and the two causes that
produce it are both checked before the script connects:

1. `MAIL_USERNAME` must be Brevo's own SMTP login (`…@smtp-brevo.com`), not a
   Gmail address.
2. `MAIL_PASSWORD` must be an SMTP key (`xsmtpsib-…`). An API v3 key
   (`xkeysib-…`) is accepted by Brevo's HTTP API and never over SMTP.

Then `MAIL_FROM_ADDRESS` has to be a sender Brevo has verified, or the login
succeeds and the send is refused separately.

**Fit Generations is done, and on a separate Brevo path.** Patch 0003 added an
SMTP provider (it previously only had Resend) and patch 0005 the six member
emails. Live and verified: relay accepted two test sends on 14 October.

Three things learned there that apply to 64theatre too:

- `SMTP_USER` is Brevo's **generated login** (`…@smtp-brevo.com`), never the
  from-address. Authenticating as `info@…` gives a 535 that reads as a wrong
  password.
- An **authenticated domain** lets you send as any address on it, mailbox or
  no mailbox. Single-sender verification needs a real inbox to click a link,
  so it is not available for an address that does not exist.
- Sending and receiving are separate. `info@fitgenerationsgym.com` sends and
  cannot receive, so `MAIL_REPLY_TO` carries a real address or replies bounce.

64theatre is still `MAIL_MAILER=log`. Same account, same two traps.

---

## Where things actually live

| App | Path | Compose | Notes |
|---|---|---|---|
| 64theatre | `/srv/64theatre` | `compose.yml` | Laravel. Logs to `storage/logs/laravel.log`, **not** `docker logs` |
| Fit Generations | `/root/fit-generations-gym` | `docker-compose.behind-proxy.yml` | Next.js. Logs to stdout, so `docker logs` is right |
| StackUp | `/srv/stackup` | `compose.yml` | |
| St Stephen's | `/srv/ststephen` | `compose.yml` | |

Never run the gym's `docker-compose.yml` or `ops/install-edge.sh` — both bind
80/443 and would take down all nineteen hostnames.

---

## Still open, in the order they will hurt

1. **No backups of anything.** `deploy/contabo/backup.sh --list` is read-only
   and shows what it would cover. 64theatre holds payment records.
2. **Default admin passwords.** 64theatre is still on
   `change-me-on-first-login` while taking real money. Fit Generations falls
   back to `admin123` when `ADMIN_PASSWORD` is unset — check it.
3. **Service wallet PENDING** (above).
4. **Shared PayHero account.** Both apps spend one service wallet, so one
   client's traffic can stop another's sales, and the fees come out of the
   same place. Separate accounts per client when it is not urgent.
5. **StackUp has no tests**, while the portfolio claims "a CI gate asserts
   cross-workspace isolation on every push". Fix one or the other before an
   interviewer reads it.
6. **The gym has one user — the admin.** No members, so no member email has
   been delivered end to end yet; only the relay is proven. The first real
   member is also the first real test of the invoice flow.
7. **The gym's cron tick needs a schedule.** `/api/cron/tick` drains the
   outbox and nothing calls it on a timer, so a queued reminder waits for
   someone to press the admin button. A `cron` entry on the box is enough.

---

## A patch is only as good as the state it was checked against

Patch 0003 failed on the box with `patch does not apply`. Its compose and
`.env.example` hunks carried the whole of patch 0001, because the patches were
split from a baseline that did not have 0001 applied — and my `git apply
--check` passed because I ran it against that same wrong baseline.

So: **check a patch against a reconstruction of the target, not the tree it
was written in.** Build the base from the real HEAD plus the patches already
applied, in order, then check. It takes a `git worktree add` and catches the
one class of failure a local check cannot see. The patches for this app are
ordered and cumulative; they are not independent.

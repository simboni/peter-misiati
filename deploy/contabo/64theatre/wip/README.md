# Work in progress — NOT for deployment

Nothing in this folder is numbered, so `apply-patches.sh` ignores it. That is
deliberate: it globs `00*.patch`, and these must never be picked up by a
routine deploy.

## `tips-and-referral-visibility.patch`

Two things, parked together on the evening before a show because one of them
carries a migration and the other was unfinished.

### Not finished: on-stage tipping

The audience tipping a named performer from a QR code. Built so far:

- `cast_members` table, and a public uuid on each performance
- `CastMember`, with the safeguarding rules in one place (`isTippable()`)
- `Tips` service, `TipController`, and the public page at `/tip/{uuid}`
- `Ledger::postTip()` — credits `tips_payable`, **never** `sales`, because a
  tip is money the theatre is holding for somebody else. Counting tips as
  takings would overstate income by exactly what is owed out.
- `Checkout::confirm()` routes a tip to that posting
- The **Cast & tipping** list inside an event, with consent and under-18
  handling

Not built: the settings tab to switch it on, the QR/poster for a performance,
and the payout recording. **No tests at all yet.** It is off by default, so
nothing it adds is reachable, but it has not been proven and must not ship on
that basis.

> The safeguarding rules are the part worth keeping if this is ever rewritten.
> A performer is listed publicly only if they are active, have consented, and
> are not a minor — and a minor is never listed whatever else is set, because
> a child's name beside a "send money" button is not something an adult's
> tick-box can authorise. All three are checked in `CastMember::isTippable()`
> so a new screen cannot forget one, and `Tips::start()` re-checks it on the
> way in, because the id arrives in a POST and a POST is whatever somebody
> sends.

### Finished and tested: a declined referral explaining itself

This half is done — 23 referral tests plus 21 public ones, all passing — and
was parked only because it carries a migration.

**The problem it fixes.** A seller shares their link, somebody buys a ticket,
and no commission appears. No row, no message, nothing on their page or in the
admin to say the sale was even seen. The first thing anybody does with a new
link is test it themselves, with their own phone — which is exactly the case
the self-referral rule refuses. The rule is correct. It was also completely
silent, and a rule nobody can see is indistinguishable from a bug.

It adds `orders.referral_declined_reason`, written at the moment the decision
is made, and then shows it:

- on the seller's own page, under **Sales that did not earn**
- as a count and the latest reason on the admin's seller list
- as a line on **Commission owed**

It also puts **Earn With Us** in the site header and the phone menu, not only
the footer, and rewrites the signup page to read as an offer.

**Apply it after the show**, with the migration:

```bash
cd /srv/64theatre/repo
git apply /srv/smp-portfolio/repo/deploy/contabo/64theatre/wip/tips-and-referral-visibility.patch
cd /srv/64theatre && docker compose up -d --build --force-recreate
docker compose exec app php artisan migrate --force
```

That applies the tipping work too. Splitting them cleanly means separating
edits that share files (`Order.php`, `routes/web.php`), which is work for a
calm day rather than a show night.

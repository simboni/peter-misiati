# How cost and profit are worked out

Every figure in this file is printed by `scripts/costing-story.ts`, which buys,
sells, mixes and sells again through the same functions the counter and the
reports use. Nothing here is a description of the code. It is the code's own
output, and it can be produced again at any time:

```sh
rm -rf /tmp/story && mkdir -p /tmp/story
RIZIKI_DB=/tmp/story/pos.db node --experimental-strip-types scripts/costing-story.ts
```

---

## The seven rules

**1. Cost is per kilo, litre or piece — never per drum.** Ufacid arrives in
250 kg drums and in 200 kg drums. Averaging "the cost of a drum" across two
different drums produces the cost of nothing, and every margin built on it is
wrong. A kilo is a kilo whatever it came in.

**2. Cost arrives with the goods.** It is never typed in by hand. What the
supplier charged, plus that line's share of the transport, divided by what
actually arrived. Transport is split across the lines in proportion to their
value, and the last line takes the leftover cents so the shares always add up
to the transport paid.

**3. Each delivery blends into what is already on the shelf.**

> new cost = (value held + value arriving) ÷ (quantity held + quantity arriving)

A running weighted average, chosen over FIFO layers deliberately: with imported
chemicals repricing every few weeks, an always-current average keeps selling
prices honest, and it is one column rather than a layer table.

**4. The cost is frozen onto the sale the moment it is made.** Changing a price
or receiving a dearer drum tomorrow cannot reach back and rewrite what last
month earned. Every sale line keeps the cost that was true when the goods left.

**5. When nobody wrote a cost down, the report says so.** A delivery can be
booked in before its invoice arrives. Anything sold from it meanwhile is valued
at what that product costs today, and the amount that had to be valued that way
is printed beside the figure. Where there is no cost anywhere — not on the line,
not on the product — it is reported as *uncosted sales*, not as free goods. Zero
cost is not a cheap sale, it is an unknown one.

**6. Mixing: all the money that went in lands on what came out.** The made
product is heavier than the concentrate that made it, so it costs **less** per
litre — water carries mass but no money. And the yield is what the drum actually
held, not what the recipe hoped for.

**7. Profit.**

> gross profit = sales − cost of goods sold
> net profit  = gross profit − expenses
> margin      = gross profit ÷ sales

---

## The worked example

A shop that has just been cleared: every shelf at zero, the books starting
today.

### 1 · Ungerol arrives

```
Two 250 kg drums at KES 78,000 each   goods     KES 156,000.00
The lorry                             transport   KES 4,000.00
                                      landed    KES 160,000.00 for 500 kg

COST ON FILE   KES 160,000.00 ÷ 500 kg = KES 320.00 a kilo    ·    on the shelf 500 kg
```

The transport is part of the cost. A drum that costs KES 78,000 at the supplier
and KES 2,000 to bring across town cost the shop KES 80,000, and pretending
otherwise overstates every margin it is ever sold at.

### 2 · 20 kg sold over the counter

```
Charged   20 kg × KES 513.00 = KES 10,260.00
Cost      20 kg × KES 320.00 =  KES 6,400.00    ← written onto the line, never changed again
PROFIT                          KES 3,860.00    (37.6% margin)
Shelf     480 kg left
```

### 3 · The next drum costs more

```
One 250 kg drum at KES 95,000 + KES 3,000.00 = KES 98,000.00  →  KES 392.00 a kilo

Held before  480 kg at KES 320.00  =  KES 153,600.00 of value
Arriving     250 kg at KES 392.00  =   KES 98,000.00
BLENDED      KES 251,600.00 ÷ 730 kg  =  KES 344.66 a kilo
```

Yesterday's sale still says KES 320.00 a kilo and still shows KES 3,860.00 of
profit. The blend only applies from here on.

### 4 · A batch of Multipurpose is mixed

The recipe, scaled to 200 L, priced at what each ingredient costs *now*:

```
   Ungerol                     10 kg ×   KES 344.66 = KES 3,446.60
   Ufacid                       5 kg ×   KES 350.02 = KES 1,750.10
   Salt                        10 kg ×    KES 59.94 =   KES 599.40
   Caustic Soda               0.2 kg ×   KES 150.23 =    KES 30.05
   C.M.A                      0.2 kg ×   KES 299.70 =    KES 59.94
   Colour (assorted)          0.2 kg × KES 1,798.20 =   KES 359.64
   Perfume                    10 pcs ×   KES 150.22 = KES 1,502.20
                                                     ────────────
   What went in                                      KES 7,747.93
   What came out          196 L      (the recipe aimed at 200 L; 196 L is what it made)

   COST OF THE MIX        KES 7,747.93 ÷ 196 L = KES 39.53 a litre
```

Two things happen in that last line. The chemicals leave the shelf and the
product arrives on it, in one transaction — so nothing is ever counted twice.
And the cost divides by **196**, not 200: the four litres that did not
materialise are carried by the ones that did, which is why the yield is typed
in rather than assumed.

### 5 · 20 L of the product is sold

```
Charged   20 L × KES 220.00 = KES 4,400.00
Cost      20 L ×  KES 39.53 =   KES 790.60
PROFIT                        KES 3,609.40    (82.0% margin)
```

That margin is high because these are the sample recipe's prices, not the
shop's. The arithmetic is the point, not the number.

### 6 · The same recipe, mixed to order instead

When a recipe is billed at the counter rather than batched in advance, the sale
is written as one priced line for the product and unpriced ingredient lines
underneath it:

```
THE PRODUCT   Multipurpose — 20 L bundle   charged KES 4,400.00   cost     KES 0.00
  ingredient  Ungerol                      charged     KES 0.00   cost   KES 344.66
  ingredient  Ufacid                       charged     KES 0.00   cost   KES 175.01
  ingredient  Salt                         charged     KES 0.00   cost    KES 59.94
  ingredient  Caustic Soda                 charged     KES 0.00   cost     KES 3.00
  ingredient  C.M.A                        charged     KES 0.00   cost     KES 5.99
  ingredient  Colour (assorted)            charged     KES 0.00   cost    KES 35.96
  ingredient  Perfume                      charged     KES 0.00   cost   KES 150.22
                                           ─────────────────────  ────────────────
                                                   KES 4,400.00        KES 774.78
PROFIT KES 3,625.22   (82.4% margin)
```

The receipt shows one charge; the stock ledger shows seven chemicals leaving.
Both are true and neither is double counted — but **a report that reads those
rows as they lie says the mix was free to make and the chemicals were given
away.** That was a real bug, fixed in September 2026: the grouped reports now
strike the ingredient rows out as products in their own right and move what
they cost onto the priced row that consumed them.

Note the two routes differ by KES 15.82 on the same 20 litres — KES 38.74 a
litre made to order against KES 39.53 from the batch. That is the four litres
the batch lost, and it is supposed to be there.

### 7 · What the report says

```
Sales                  KES 19,060.00
Cost of goods sold  −   KES 7,965.38
                      ──────────────
Gross profit           KES 11,094.62
Expenses            −   KES 1,200.00
                      ──────────────
NET PROFIT              KES 9,894.62      51.9% of sales

What earns, product by product:
   Ungerol                      sold KES 10,260.00   cost KES 6,400.00   profit KES 3,860.00   38%
   Multipurpose — 20 L bundle   sold  KES 4,400.00   cost   KES 774.78   profit KES 3,625.22   82%
   Multipurpose Cleaner         sold  KES 4,400.00   cost   KES 790.60   profit KES 3,609.40   82%

Do the rows add up to the total?   sales true   cost true

Still on the shelf: 719 kg of Ungerol at KES 344.66 a kilo = KES 247,810.54 of the shop's money.
```

The last two lines are the ones worth keeping an eye on. The product rows must
always add up to the period total — if they ever do not, something is being
counted twice or lost, and the tests in `tests/mix-profit.test.ts` fail rather
than letting it reach a screen. And what is on the shelf is valued at cost, not
at the asking price: it is money the shop is holding, not money it has made.

---

## Where each rule lives in the code

| Rule | File |
| --- | --- |
| Transport spread over the lines | `src/lib/purchasing.ts` · `prorateTransport` |
| The weighted average | `src/lib/db.ts` · `updateAverageCost` |
| Replaying it after a correction | `src/lib/purchasing.ts` · `recomputeCost` |
| The cost frozen onto a sale line | `src/lib/sales.ts` · `resolveLines` |
| What a batch costs, and its yield | `src/lib/mixing.ts` · `recordMix` |
| Today's-price fallback, and saying so | `src/lib/reports.ts` · `LINE_COST_SQL` |
| Putting a mix back together | `src/lib/reports.ts` · `profitPerProduct` |
| Gross, net and margin | `src/lib/reports.ts` · `profitSummary` |

---

## When a day comes out negative

Three quite different things put a minus sign on a day, and they want three
quite different answers. The dashboard can show *that* a day lost money; it
cannot show which of these it was. This can:

```sh
npm run why -- 2026-09-22
```

It reads the books — it never writes to them — and names the cause.

**1 · Money spent, not money lost.** Rent, a lorry, a drum paid for in cash.
The goods still sold at a profit; the shop simply paid out more than it took
that day. Gross profit stays positive and only the net goes under. Nothing is
wrong and nothing needs correcting. On the dashboard it is the Expenses column
on that row carrying the number.

**2 · Something sold below what it cost.** Gross profit itself is negative.
Either the asking price is too low or the cost on file is too high. The product
shows up in the losing-money list with a negative margin, and if its cost is
still above its price today it will go on losing money on every sale until one
of the two numbers moves.

**3 · A cost price entered after the fact.** A sale made before anybody recorded
what the goods cost carries no cost of its own, so the reports value it at what
that product costs **today** — and say how much they had to. Fix the cost
wrongly and every past day that sold from it turns negative at once, without
anybody touching those days. The classic slip is a whole drum's price typed into
a box that means *per kilo*: a 250 kg drum at KES 380 a kilo entered as KES
95,000 multiplies every past sale by two hundred and fifty.

The third is the only one that rewrites history, and it is also the only one
with a one-field fix: put the right per-unit cost on the product and every day
it touched comes back on its own.

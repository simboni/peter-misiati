# WhatsApp cards — the deck, and what to type under each one

Nine images in `public/marketing/cards/`. Six squares (1080²) for chats, DMs and
feeds; three stories (1080×1920) for WhatsApp Status.

**One rule, same as the ad captions:** every message ends in a single action —
WhatsApp **+254 706 289 514** or **smp-developers.com**. Reply within the hour.

## Which card to send when

| Situation | Send |
| --- | --- |
| Someone asks "what do you do?" | `card-01-business` — it replaces the paper card |
| They ask what you can build | `card-02-services` |
| They're weighing you against someone else | `card-03-proof` |
| They run a shop, factory, depot | `card-04-riziki` |
| They handle invoices, payments, a SACCO | `card-05-tallypay` |
| They've said yes and want to know how | `card-06-start` |
| Status, three times a week | the three `story-*` images |

Don't post all three stories the same day. One per slot, spaced out — the
business card first, the offer mid-week, the case study at the weekend.

The business card carries a QR that opens a WhatsApp chat with you. It is meant
to be **shown on a screen or printed** — someone scans it off your phone and
they're already typing. It does nothing when it's sent *inside* WhatsApp, so send
that one to people who will save or print it, and use the plain number otherwise.

---

## card-01-business · the digital business card

Send it once, on first contact. Also the one to print on the back of anything.

> Peter Misiati — I build the software organisations run on.
>
> 🏗️ Systems & ERP · 🌍 Websites · 💳 Fintech & M-Pesa · 📚 E-learning
> 📍 Nairobi & Bungoma · 10+ years · 100+ projects
>
> Scan the code on the card to chat, or save this number.
> 🔗 smp-developers.com

## card-02-services · the menu

For "can you build X?" — send it and let them point.

> Six things I build, and nothing I don't:
>
> 1️⃣ Web apps & internal systems — ERP, microfinance, admin dashboards
> 2️⃣ Custom websites — business, NGO, political, personal
> 3️⃣ Fintech & M-Pesa — SACCO, payments, savings
> 4️⃣ SaaS & dashboards — multi-tenant, built to scale
> 5️⃣ E-learning & LMS
> 6️⃣ Mobile apps & consulting
>
> Which one is your problem? 👇
> 📩 WhatsApp +254 706 289 514 · 🔗 smp-developers.com

## card-03-proof · the receipts

Send when you're being compared. Names do the arguing for you.

> Ten years. 100+ projects. Every one a full case study — the problem, the
> approach, the result.
>
> NGOs — COSDEP Kenya, Canossian Sisters, Talitha Kum
> Business — Zuri Place Resort, Fit Generations, Misiati & Associates
> Fintech & systems — TallyPay, Naveedex, StackUp, 64 Theatre
> Public figures — Dr. Dennis Wamalwa, Misiati MC
>
> Read any of them → smp-developers.com

## card-04-riziki · case study, a factory off paper

The best card for any trader, shop, depot or small manufacturer.

> A detergent factory ran on paper books. Now it runs on one system.
>
> ✅ Formulas versioned and owner-only — staff never see the recipes
> ✅ Stock as an append-only ledger — no quiet edits, every movement traceable
> ✅ Cash + M-Pesa + credit split on one bill, with debt limits and ageing
> ✅ Keeps selling with no network, syncs when the line comes back
>
> If your stock and your books disagree at the end of the month, that's the
> problem I solve.
> 📩 WhatsApp +254 706 289 514

## card-05-tallypay · case study, getting paid

For anyone whose invoices live in a spreadsheet and a WhatsApp thread.

> Quote → Invoice → Receipt. One flow, M-Pesa built in.
>
> ✅ STK push to the customer's phone, receipted the moment it clears
> ✅ Deposits, balances and 16% VAT handled correctly — integer cents, unit-tested
> ✅ A separate workspace per business, with a white-label Pro tier
>
> Live: tallypay.co.ke
> Need the same for your business? 📩 +254 706 289 514

## card-06-start · how it works

Send the moment someone says "okay, how do we start?"

> From first message to live site in one week.
>
> 1️⃣ You WhatsApp me — tell me what the business does
> 2️⃣ You get a fixed price and a delivery date, before anything starts
> 3️⃣ You watch it being built — a live link from day one
> 4️⃣ You get the keys — domain, hosting, dashboard and training
>
> Websites from KES 20,000 · free domain + hosting for a year · unlimited changes.
> 📩 +254 706 289 514

---

## The three Status images

Post the story file, not the square — the square gets cropped.

**story-01-card**

> I build the software organisations run on — systems, websites and fintech.
> 10+ years, 100+ projects, here in Kenya.
> Scan to chat 👆 or +254 706 289 514

**story-02-offer**

> Your business needs a website that actually brings customers. 👇
> ✅ Custom-built, from KES 20,000
> ✅ Ready in 1 week
> ✅ FREE domain + hosting for 1 year
> ✅ Your own dashboard — you update it yourself
> ✅ Unlimited changes
> smp-developers.com · +254 706 289 514

**story-03-riziki**

> A detergent factory's whole business — mixing, stock, credit, daily cash —
> off paper and into one system.
> Recipes stay secret. Stock can't be fudged. Works with no network.
> Yours next? +254 706 289 514

---

## Regenerating or editing them

`tools/marketing-cards/` builds the deck — see the README there. Layout and copy
live in `build.mjs`, one entry per card, so changing a price or a headline is one
edit and one command, not nine images in an editor.

Note the story frames deliberately reserve their top and bottom: WhatsApp draws
the sender row over the top of a Status and a Reply bar over the bottom, so
nothing important goes there. If you move things around, keep clear of both.

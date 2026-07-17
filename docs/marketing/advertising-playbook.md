# Advertising & Automation Playbook

**Straight talk first.** A fully self-built "auto-posting robot" for personal social accounts isn't the right move — and mostly isn't possible:
- **WhatsApp Status has no API at all.** Nothing can post it for you. (And it's your highest-converting channel.)
- **LinkedIn** restricts automated posting on personal profiles; unofficial bots risk account bans.
- **Meta (Facebook/Instagram)** allows scheduling — but through its own official, free tools.

So the winning setup is: **official schedulers for what can be automated + the CRM cockpit for what can't.** You get 90% of the automation with zero risk and zero monthly cost. Here's the exact setup.

---

## 1. What to automate, and with what

| Channel | Tool | Automation level | Setup time |
|---|---|---|---|
| Facebook Page + Instagram | **Meta Business Suite** (free, official) | Schedule a month ahead — true set-and-forget | 30 min once |
| LinkedIn | **LinkedIn native scheduler** (clock icon in the post composer) | Schedule up to 3 months ahead | 0 min |
| WhatsApp Status | **CRM cockpit** (copy → paste → post) | 30 seconds per post, prepared in advance | 0 min |
| X/Twitter (optional) | Native scheduler via analytics.x.com or skip | Low priority for your market | — |

### One-time setup (do this week)
1. Create a **Facebook Page** for SMP Developers (not just your profile) → link **Instagram business account** to it.
2. Open **business.facebook.com** → Planner → schedule all 8 Month-1 posts (captions in the CRM's Campaigns tab, images in `public/marketing/` + `public/mockups/`). Done — Facebook + Instagram now run themselves for a month.
3. On **LinkedIn**: write post → click the ⏰ clock icon → schedule Mon/Thu 8:30am for the month.
4. WhatsApp Status stays manual by design: open the CRM → Campaigns → Copy → paste into Status. Twice a week, ~30 seconds.

**Monthly rhythm:** each month I draft the next 8 posts (send me your latest screenshots/launches) → you spend one 45-minute session scheduling everything → the month runs itself.

## 2. Paid ads — when and how (don't start here)

Run paid ads only **after** the organic engine works (day 30+, once you have reviews + steady posts). Then:

### Meta Ads starter pack (KES 500–1,000/day, 2-week tests)
Three campaigns, one per money niche — creatives already exist:

**A. NGO websites** — objective: WhatsApp messages
- Creative: COSDEP mockup + "An NGO's website is a funding document."
- Audience: Kenya · 28–55 · interests: NGO management, nonprofit, development, grant writing · admins of pages
- CTA: "Send WhatsApp message"

**B. SME websites** — objective: WhatsApp messages
- Creative: capabilities square card + Fit Generations before/after framing
- Audience: Nairobi + Eldoret + Bungoma · 25–55 · small-business owners, entrepreneurship interests
- CTA: "Send WhatsApp message"

**C. SACCO/fintech systems** — objective: lead form (higher-ticket, capture details)
- Creative: TallyPay mockup + "Your SACCO members deserve mobile access."
- Audience: Kenya · 30–60 · SACCO, microfinance, cooperative interests
- CTA: instant form (name, org, role, phone)

**Rules:** one variable per test · kill anything above ~KES 300 per conversation after 1 week · winner gets the budget. Track every ad-sourced lead in the CRM with source = "Social media".

### Google (later, high intent)
- **Google Business Profile first — it's free** and captures "web developer Nairobi/Bungoma" searches. Photos + services + 5 reviews.
- Google Search ads only after GBP + reviews exist ("website design Kenya", "SACCO management system Kenya" — the latter is cheap and high-value).

## 3. The CRM ties it together (`smp-crm.html`)

- **Campaigns tab** = your publishing cockpit: month-1 queue preloaded, copy-caption button, one-tap links to LinkedIn/Meta composer/WhatsApp, mark-as-posted tracking.
- **Pipeline** = every reply from any channel becomes a lead with follow-up dates (overdue ones surface on the dashboard).
- **Scripts** = outreach templates that auto-fill the lead's name/organisation and auto-log the touch + set the day-3 follow-up.
- **Data** = CSV import/export (compatible with `leads.csv`). Data lives only on your device.

Open it in any browser (phone or laptop). Nothing is uploaded anywhere.

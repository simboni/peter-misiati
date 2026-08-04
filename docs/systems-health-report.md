# Systems Health Report — SMP Developers / Peter Misiati

**Generated:** 2026-08-03 · **By:** Claude Code health-check session

This is a plain-language status check of every system in the portfolio: the
websites/apps that are live, the code that builds them, and the accounts and
renewals that keep them running. It is written for a non-specialist — each
finding says *what it means* and *what to do*.

---

## 0. The one big limitation (read this first)

This health check ran inside the **Claude Code web sandbox**, whose network is
locked down by policy. It **cannot reach your live websites** — every request to
`stackup.co.ke`, `smp-developers.com`, etc. was refused by the egress proxy
(`403`, "destination host not allowed"). The TLS certificates it sees are the
sandbox's own, not the real ones.

**Therefore this report cannot, by itself, tell you whether a site is up right
now, or when its SSL/domain expires.** A previous automated session hit the same
wall and noted it explicitly.

➡️ **To get that data, run the script below from a normal machine** (your laptop,
a phone with Termux, or any VPS). It takes ~30 seconds:

```bash
./scripts/health-check.sh
```

It prints, for all 12 systems: **UP/DOWN** (HTTP status), **SSL expiry** (days
left), and **domain-registration expiry** (days left, if `whois` is installed).
That is the "expirations / server" data you asked for — it just has to run from
outside the sandbox. Everything else below **was** verifiable and is reported as
fact.

---

## 1. Live systems inventory (12 production systems)

Pulled from `src/lib/portfolio.ts`. "Status here" = what this sandbox could
confirm; **live up/down must be confirmed with the script.**

| # | System | URL | Hosting / stack | GitHub repo |
|---|--------|-----|-----------------|-------------|
| 1 | **StackUp** (flagship SaaS) | www.stackup.co.ke | Render (server image via GH Actions) + Android APK | `smp-planning` |
| 2 | Naveedex (journaling app) | naveedex.com | Next.js + Supabase | `Naveedex` (private) |
| 3 | TallyPay | tallypay.co.ke | Cloudflare D1 + Drizzle + M-Pesa | — |
| 4 | Fit Generations Gym | fitgenerationsgym.com | Next.js 16 | `fit-generations-gym` (private) |
| 5 | Misiati Associates | misiatiassociates.co.ke | Cloudflare Pages | — |
| 6 | Facilitator MC (Emmanuel) | facilitator-misiati.onrender.com | **Render free tier** | `Facilitator-Emmanuel` |
| 7 | Zuri Place Resort | zuriplaceresort.com | Docker / Caddy / Railway | `zuriplace` |
| 8 | COSDEP Kenya (NGO) | cosdepkenya.org | Next.js 16 | `Cosdep-Kenya` |
| 9 | Canossian Sisters NE Africa (NGO) | canossiansistersneafrica.org | Next.js 16 | `canossiansistersneafrica` (private) |
| 10 | Talitha Kum Kenya / RAHT (NGO) | talithakumraht.org | WordPress / PHP | `talithakum` |
| 11 | Commissioner Dr Dennis Wamalwa | www.commrdrdenniswamalwa.co.ke | Render (custom domain) | `Commissioner-Wamalwa` |
| 12 | SMP Developers + Portfolio | smp-developers.com | Static (Netlify / Cloudflare / GH Pages) | `peter-misiati` |

**Not yet launched:** *64 Theatre* ticketing platform (`64theatre-platform`,
Laravel) — in the portfolio but has **no live link** yet.

### Renewal-risk notes worth checking with the script
- **`.co.ke` domains** (stackup, tallypay, misiatiassociates, commrdrdenniswamalwa)
  are registered through KENIC and typically renew **annually** — the most common
  cause of a site suddenly going dark in Kenya. Verify each expiry date.
- **Render free tier** (Facilitator MC, and Wamalwa if free) **spins down after
  ~15 min of inactivity**, so the first visit can take 30–60s or look "down."
  That's expected, not an outage — but it's a poor client experience; a paid
  instance or an uptime pinger fixes it.

---

## 2. Portfolio codebase health (`peter-misiati`) — VERIFIED

This repo is the portfolio site + a bundled billing app. Checked directly:

| Check | Result | Notes |
|-------|--------|-------|
| **Production build** (`npm run build`) | ✅ **Pass** | 25 static pages generated cleanly (Next.js 16, Turbopack) |
| **TypeScript** (`tsc --noEmit`) | ✅ **Pass** | No type errors |
| **Lint** (`eslint`) | ✅ **Fixed** | Was 2 errors (`setState` inside `useEffect` in `site-header.tsx` & `theme-switcher.tsx`); rewritten with `useSyncExternalStore` / prev-prop pattern. Clean now. |
| **Security audit** (`npm audit`) | ✅ **0 vulns** | Was 4 high (`postcss` XSS/path-traversal, `sharp`/libvips CVEs). Fixed by bumping `next` to **16.3.0** + `react` to 19.2.8. Build re-verified. |
| **Dependency freshness** | ✅ Current | `next`, `react`, `react-dom` now on latest patched releases. |

**Bottom line:** the site builds and ships fine, and the lint + security issues
are now resolved on branch `claude/systems-health-check-a3dt0d`. **These fixes
still need to reach the default branch** (merge this branch) to clear the
Dependabot alerts GitHub reports there — and the bundled **billing app** has its
own dependency tree that needs the same `next` bump on its branch.

---

## 3. GitHub & CI/CD — VERIFIED

- **Account:** `github.com/simboni` — **20 repositories** (mix of public/private),
  most created/updated in July 2026. This is the source-of-truth for every system
  above.
- **CI on `peter-misiati`** (latest run per workflow):
  | Workflow | Latest result |
  |----------|---------------|
  | Deploy to Netlify | ✅ success |
  | Deploy billing app | ✅ success |
  | Build mobile app (Android) | ✅ success |
  | Deploy to GitHub Pages | ❌ failure — **benign** (see below) |

  → **The GitHub Pages "failure" is not a real problem.** That workflow is
  **manual-only** (`workflow_dispatch`) and self-describes as an *"optional backup —
  Netlify is the primary host."* The failed run was a hand-triggered test whose
  deploy step failed only because GitHub Pages isn't enabled in repo Settings. It
  never runs automatically and **nothing live depends on it.** Leave it, or enable
  it (Settings → Pages → Source: GitHub Actions) only if you want free fallback
  hosting. **Netlify is your working host.**
- **Open pull requests on `peter-misiati`: 2, both stale** (last touched mid/late
  July, never merged):
  - **#1** Multi-vendor billing & invoicing platform (M-Pesa + Resend)
  - **#2** Canossian Sisters NE Africa redesign
  → Decide: merge, or close. Long-lived open PRs quietly rot as the base moves on.
- **Default branch** of `peter-misiati` is `claude/portfolio-design-plan-9ol8sb`
  (not `main`); `main` is behind. Not a problem, but good to know.

---

## 4. Automation & monitoring — VERIFIED

- **Scheduled jobs (crons): none active.**
- **Routines / triggers:** 12 exist but **every one is a one-shot that already
  fired** (`run_once_fired`) — mostly past "check this CI run / APK build"
  reminders. **Nothing is monitoring your live sites on a schedule.**

➡️ **You currently have no automated uptime or expiry monitoring.** That is the
single biggest gap for a portfolio of 12 client sites — an expired `.co.ke`
domain or a down Render app would only be discovered by a client complaining.
See recommendations.

---

## 5. Connected services — VERIFIED

- **Gmail** — connected & active (`misiatipeter@gmail.com`). Used for inbox
  search / drafts.
- **GitHub** — connected (this session, scoped to `peter-misiati`).
- **Contact form** (`/contact`) posts to **FormSubmit** (no backend). It only
  delivers **after a one-time activation email** has been clicked. If you've
  never done that, **enquiries are silently not arriving** — worth a test submit.

---

## 6. Recommended actions (prioritised)

**Do now (protects revenue / client trust):**
1. **Run `./scripts/health-check.sh` from your laptop** and record every SSL &
   domain expiry date. Put the soonest ones in your calendar with a 30-day
   reminder.
2. **Set up uptime + expiry monitoring** so you're told *before* a client is.
   Free options: **UptimeRobot** or **Better Stack** (uptime + SSL-expiry +
   domain-expiry alerts, 12 monitors fits the free tier). This replaces the
   manual script with always-on alerts.
3. **Confirm the FormSubmit contact form is activated** (send a test enquiry).

**Do soon (housekeeping):**
4. ~~Fix the failing GitHub Pages workflow~~ — **resolved as benign** (manual/optional
   backup; Netlify is primary). No action needed unless you want Pages as a fallback.
5. **Resolve the 2 stale PRs** (merge or close).
6. ~~Patch the security audit~~ — ✅ **done** on this branch (0 vulns). Still to do:
   merge it to the default branch, and apply the same `next` bump to the billing app.
7. ~~Fix the 2 lint errors~~ — ✅ **done** on this branch (eslint clean).

**Consider:**
8. **Move client-facing Render apps off the free tier** (or add a keep-alive ping)
   so Facilitator MC / Wamalwa don't cold-start for visitors.

---

## 7. How to re-run this check

- **Codebase health:** `npm install && npm run build && npm run lint && npx tsc --noEmit && npm audit`
- **Live systems (uptime / SSL / domain expiry):** `./scripts/health-check.sh`
  *(run from a machine with open internet — not the Claude web sandbox)*
- **CI status:** GitHub → each repo → **Actions** tab.

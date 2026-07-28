# The Wamboka Record

A **transparency-first re-election site** for Hon. Jack Wanami Wamboka, MP for
Bumula Constituency (Bungoma County) — built like an audit file, not a poster.

## The strategy

Most campaign sites are adjectives. This one is a ledger:

- **Every claim carries a source** — a chip linking to Parliament records, the
  NG-CDF Board, the Auditor-General, or national press.
- **Every figure carries a status** — `VERIFIED` (official record),
  `REPORTED` (credible press, official document pending) or `PENDING`
  (official figure not yet published — stated openly, never invented).
- **The bad news is published too** — the Integrity File carries the 2026
  committee findings in full: the bribery allegation that was dismissed *and*
  the conduct finding that was upheld. An open file is the differentiator.

## Pages

| Route          | Purpose                                                              |
| -------------- | -------------------------------------------------------------------- |
| `/`            | Overview — positioning, headline stats, three fronts, term timeline  |
| `/record`      | Oversight casework: Linturi impeachment, universities probe, CDF fight |
| `/money`       | The money trail: NG-CDF allocations by FY, spend priorities, pledge  |
| `/bumula`      | Constituency delivery: education results, bursaries, scholarships    |
| `/integrity`   | The Integrity File — allegations, findings, outcomes, unedited       |
| `/methodology` | Sourcing rules, status definitions, official registers               |

## Editing content — one file

**All content lives in [`src/lib/data.ts`](src/lib/data.ts).** Every fact is a
typed record with `claim`, `date`, `status` and `sources[]`. The pages render
whatever that file contains — add an allocation row, a project, or a timeline
event there and it appears with its badge and source chips.

### Before public launch

1. Transcribe the `pending` entries from official records (IEBC certified
   results, NG-CDF Board allocation schedules, OAG audit reports) and flip
   their statuses.
2. Set the real domain in `site.domain`.
3. Have the candidate's legal team review the Integrity File wording.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 — exported
as a fully static site (`output: 'export'`).

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export → ./out
```

Deploys to any static host (Vercel, Cloudflare Pages, Netlify, GitHub Pages).

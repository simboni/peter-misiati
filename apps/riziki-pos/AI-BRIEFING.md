# Brief for any AI assistant working on this code

**Paste this whole file into the chat first, whichever assistant you are using
— ChatGPT, DeepSeek, Gemini, Copilot, Claude.** Then paste the error and the
file you are asking about.

It exists because this project breaks the assumptions a model brings with it,
and the failures are quiet ones: code that compiles, deploys, and gets the money
wrong.

---

## What this is

A point-of-sale, stock and mixing system for Riziki Industrial Chemicals, a
detergent-chemicals shop in Nairobi CBD. One shop, one counter phone, a laptop
in the back, an owner and an attendant.

```
Next.js 16 (App Router)  ·  React 19  ·  TypeScript  ·  Tailwind CSS v4
node:sqlite (SQLite, WAL mode)  —  no ORM, plain SQL
Docker Compose + Caddy on a small VPS
```

Run it locally with no server, no Docker and no keys:

```
npm install
npm run seed        # a shop's worth of realistic data
npm run dev         # http://localhost:3100
npm test            # 353 tests. THESE ARE THE GUARD RAIL.
npx tsc --noEmit    # types
npm run build       # the build the server will do
```

---

## The five rules. Breaking any of them is a bug, not a style disagreement.

**1. This is Next.js 16, not 13 or 14.** Most models answer with the older API
and it is wrong here in ways that compile:

- `cookies()`, `headers()`, `params` and `searchParams` are **async**. Every
  page reads `const { id } = await props.params`.
- Server Actions are `"use server"` functions, called from forms directly.
- There is no `pages/` directory, no `getServerSideProps`, no `_app.tsx`.
- Read `node_modules/next/dist/docs/` before writing anything you are unsure
  of — the real documentation for the installed version is in the repository.

**2. The ledger is append-only, by database trigger.** `sales`, `sale_lines`,
`stock_movements`, `pack_moves` and `price_changes` refuse UPDATE and DELETE.
This is deliberate: it is what makes the audit trail worth anything, and it is
the shop's only defence against shrinkage. Every correction is a **further
entry** — a void, a stock take, a correcting movement. If your fix needs to
update one of those rows, the fix is wrong. Do not remove the triggers.

**3. Money is integers. Quantities are integers.** Cents for money
(`price_cents`, `total_cents`), thousandths for quantities (`qty_milli`,
`size_milli` — "milli"). No floats anywhere near a price. A cost is stored per
canonical unit (per kg / L / piece), and a line's cost is
`Math.round(cost_cents * qty_milli / 1000)`.

**4. The shop is UTC+3, always, with no daylight saving.** Every report groups
by `date(at, '+3 hours')`. Group by raw UTC and the day's drawer stops agreeing
with the day's report, and the owner starts accusing staff of theft over an
arithmetic bug.

**5. Staff must never receive owner data.** Cost prices, margins, profit,
recipes and reagent quantities are gated **on the server**, before the query
runs — not hidden in the markup. An attendant's phone never receives the bytes.
Never "fix" a screen by rendering owner data and hiding it with CSS or a
conditional in JSX.

---

## Three traps this exact toolchain has already sprung

Each of these has cost this project a real failure in production. They are in
`AGENTS.md` too.

**HTML entities in JSX text drop the leading whitespace of the chunk.** Write
the character itself — `&`, `"`, `—` — never `&amp;`, `&ldquo;`, `&mdash;`. The
compiler renders `{name} as &ldquo;x&rdquo;` as `nameas "x"`. Invisible in
review, invisible in the diff, visible to the customer.

**Never call `redirect()` inside a `try` that has a `catch`.** It reports
itself by throwing, so the catch swallows it and the screen says the action
failed when it succeeded. Do the work in the `try`; redirect after it.

**An inline `"use server"` action must not call a helper declared beside it.**
The action carries its closure across the wire and a function cannot be
serialised, so a local helper takes the whole action down — at runtime, on the
first click, never at build time. Declare helpers at module scope. The error
Next reports is `Functions cannot be passed directly to Client Components`,
which points at the props rather than at the closure.

---

## Where things are

```
src/lib/          the business rules. Every file opens with WHY it exists.
  db.ts           the connection, migrations, postMovement(), tx()
  sales.ts        recording a sale, the price band, credit, voiding
  stock-service.ts the shelf, stock takes, the ledger behind a count
  purchasing.ts   deliveries, landed cost, weighted average, corrections
  mixing.ts       batches: ingredients out, made product in
  packing.ts      how much of a thing is already poured into containers
  borrowing.ts    selling past zero, and what that means the shop owes
  reports.ts      profit, day close, exports. UTC+3 lives here.
  schema.sql      the tables, and the triggers that make them append-only
src/app/          the screens (App Router)
tests/            353 tests, plain node:test
deploy/           update, health, backups, restore, resets
```

---

## How to work on it safely

1. Reproduce it first. `npm run seed && npm run dev`, and make the bug happen.
2. Change one thing.
3. `npm test` — **all 353 must pass.** If your change breaks a test, read the
   test: it is usually describing a rule of the shop you did not know about.
4. `npx tsc --noEmit` and `npm run build`.
5. Add a test for the bug you fixed, so it cannot come back.
6. Commit on a branch, push, deploy with `deploy/update.sh`, then
   `sh deploy/health.sh`.
7. If it made things worse: `git checkout <previous-commit>` and
   `docker compose up -d --build`. The database is untouched by that.

---

## What not to paste into a chat

The code is fine to share. These are not:

- the database file or any backup of it — it holds customers' names, phone
  numbers and the shop's whole trading history;
- the server password or ssh key;
- the contents of `deploy/offsite.env`.

You never need any of them to fix a bug. If an assistant asks for the database
to "have a look", send it the schema (`src/lib/schema.sql`) instead.

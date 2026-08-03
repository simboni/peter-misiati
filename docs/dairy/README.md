# Dairy Farm Management System — Blueprint

A complete design package for a Kenyan dairy farm management system, built from
four parallel research streams: a competitor teardown, a Kenyan dairy domain
study, an adoption/UX evidence review, and an architecture scan.

**Status:** blueprint. No application code has been written yet — this is the
specification to approve before building.

## Read in this order

| # | Document | What it answers |
| - | -------- | --------------- |
| 1 | [01-findings.md](01-findings.md) | What exists, where it fails, and the wedge we take |
| 2 | [02-domain-model.md](02-domain-model.md) | The dairy facts the software must encode correctly |
| 3 | [03-modules.md](03-modules.md) | The system split into 12 modules, each independently shippable |
| 4 | [04-workflows.md](04-workflows.md) | The daily / weekly / seasonal rhythm the software must fit into |
| 5 | [05-data-model.md](05-data-model.md) | Tables, state machines, derived values |
| 6 | [06-architecture.md](06-architecture.md) | Stack, offline strategy, Next.js 16.2 constraints |
| 7 | [07-roadmap.md](07-roadmap.md) | Build order, phases, what ships when |
| 8 | [08-open-questions.md](08-open-questions.md) | What must be confirmed with the client and verified at source |

## The one-paragraph version

Kenyan dairy software fails for the same reasons everywhere: entry takes too
long, it demands connectivity the farm doesn't have, it's built for the owner
but typed into by the herdsman, and it gives nothing back at the moment of
entry. Our system inverts each of those. Every routine screen is five fields or
fewer, saves offline, and returns something useful immediately — a calving
calendar, a withdrawal-period block, a running margin. The three things no
incumbent does well, and which we make the core of the product, are:
**per-cow margin over feed cost**, **enforced antibiotic withdrawal periods**,
and **reconciliation of the co-operative's milk statement against the farm's
own delivery records**.

## Decisions already taken

| Decision | Choice | Where discussed |
| -------- | ------ | --------------- |
| Tenancy | Multi-tenant from day one | [06](06-architecture.md#multi-tenancy) |
| Location | `dairy/` folder in this repo, as its own Next.js app | [06](06-architecture.md#repository-layout) |
| Session scope | Research + blueprint first; build after approval | [07](07-roadmap.md) |
| Hosting budget | Free tiers only — see the licensing caveat | [06](06-architecture.md#hosting-under-a-zero-budget) |

## Caveats on the research

Outbound network access in the research session was restricted, so most academic
and vendor primary sources could not be opened directly; findings come from
search-result summaries with source URLs attached. Figures are tagged in each
document by confidence. [08-open-questions.md](08-open-questions.md) lists every
number that must be verified at source before it is hard-coded — the Kenyan
minimum-wage table, drug withdrawal periods, and feed bag weights especially.

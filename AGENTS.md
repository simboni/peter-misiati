<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Peter Misiati — what is in here, and what is not

This repository is Peter's own: the portfolio site, the Riziki Chemicals work
(`apps/riziki-pos`, `apps/riziki-web`), and the career, sales and marketing
writing under `docs/`.

**The client products live in their own repositories.** If a request is about
one of them, the code is not in this checkout and searching harder will not
find it. Attach the repository and work there instead.

| Ask about | Repository | What it is |
|---|---|---|
| St Stephen's, Kimaeti — the school website or the school management system (EMS) | `simboni/st-stephen-kimaeti` | Public site on GitHub Pages, plus a Next.js + Prisma + PostgreSQL EMS. Has its own `AGENTS.md` with the rules for it — read that first. |
| Holy Cross Bulimbo | `simboni/hollycrossbulimbo` | The earlier build the St Stephen's platform was adapted from. |

In Claude Code on the web, a session can only reach the repositories it was
started with. To add one, call `add_repo` with the owner and name — do not
first try to `curl` GitHub or `git ls-remote` to check it exists, because an
unauthenticated request to a private repository returns 404 whether or not you
have access, and that false negative will send you off looking for the code
somewhere it never was. Call the tool and let it answer. Then clone it where
the tool's result tells you to, and call `register_repo_root` so that
repository's own `CLAUDE.md` and skills load on the next turn.

Local checkouts in this container, when they are present, sit beside this one:
`/home/user/st-stephen-kimaeti` and `/home/user/hollycrossbulimbo`. A path that
starts `/home/user/peter-misiati/apps/...` will not reach either of them.

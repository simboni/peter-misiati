<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Three traps this toolchain has already sprung

**Never write HTML entities in JSX text.** Write the character itself — `“`, `”`, `—`. This
compiler drops the leading whitespace of any text chunk containing an entity, so
`{name} as &ldquo;x&rdquo;` renders as `nameas “x”`. It is invisible in review, invisible in the
diff, and shows up as a missing space on the customer's screen. The same class of bug has been
fixed here twice.

**Never call `redirect()` inside a `try` that has a `catch`.** It reports itself by throwing, so
the catch swallows it and the screen says the action failed when it in fact succeeded. Do the work
in the `try`, redirect after it.

**An inline `"use server"` action must not call a helper declared beside it.** The action carries
its closure across the wire and a function cannot be serialised, so a local helper takes the whole
action down — at runtime, on the first click, never at build time. Declare helpers at module scope
instead; a module-scope function is referenced, not captured. The error Next reports is
`Functions cannot be passed directly to Client Components`, which points at the props rather than
at the closure, and the user is shown an error digest with no message in it. Saving a quote failed
this way and said nothing about why.

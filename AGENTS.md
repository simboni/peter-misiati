<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Two traps this toolchain has already sprung

**Never write HTML entities in JSX text.** Write the character itself — `“`, `”`, `—`. This
compiler drops the leading whitespace of any text chunk containing an entity, so
`{name} as &ldquo;x&rdquo;` renders as `nameas “x”`. It is invisible in review, invisible in the
diff, and shows up as a missing space on the customer's screen. The same class of bug has been
fixed here twice.

**Never call `redirect()` inside a `try` that has a `catch`.** It reports itself by throwing, so
the catch swallows it and the screen says the action failed when it in fact succeeded. Do the work
in the `try`, redirect after it.

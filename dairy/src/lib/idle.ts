/**
 * The idle rules, in a module with no `next/headers` import and nothing worth
 * mocking.
 *
 * They started life in `session.ts`, which every server test replaces wholesale
 * with a three-function stub — so the moment `verifySession` began calling into
 * it, twelve test files blew up on `touchSession is not a function`. A pure
 * predicate and two numbers have no business living behind a mock boundary.
 *
 * The picker is the home state. Four people share one phone through a 5am
 * milking, so a session that outlives the person holding it silently
 * reassigns everything the next three do — which destroys the accountability
 * the whole PIN-and-face design exists to provide.
 *
 * Two different clocks, because they protect against different things and one
 * of them can lose a herdsman's work:
 *
 *   IDLE_TIMEOUT_SECONDS is measured on the DEVICE, from the last time a
 *   finger touched the screen. It has to be, because entering a milking makes
 *   no network requests at all — R3 — so a server-side 60-second window would
 *   sign a man out in the middle of a sheet he had been filling for ten
 *   minutes. The client watcher never interrupts a half-entered form; the
 *   worst case is "tap your face again", never "type it all again".
 *
 *   SERVER_IDLE_SECONDS is the belt to that braces: the longest a session may
 *   sit between REQUESTS before the server stops trusting it. A phone left on
 *   a bench with the app open is not signed in an hour later.
 *
 * The absolute session ceiling, regardless of activity, lives in session.ts.
 */
export const IDLE_TIMEOUT_SECONDS = 60;
export const SERVER_IDLE_SECONDS = 60 * 15;

/** Has this session sat untouched longer than the server will tolerate? */
export function isServerIdle(session: { lastSeenAt?: number }, now = Date.now()): boolean {
  // A session minted before this field existed has no last-seen stamp. Treat it
  // as fresh rather than bouncing everyone signed in across a deploy.
  if (session.lastSeenAt == null) return false;
  return now - session.lastSeenAt > SERVER_IDLE_SECONDS * 1000;
}

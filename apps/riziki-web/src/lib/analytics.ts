/**
 * Visitor measurement, and why it is self-hosted and optional.
 *
 * NOTHING ON THIS SITE WAS MEASURABLE. Not which pages people read, not which
 * products they searched for, not which button produced an enquiry — so any
 * money spent promoting the shop could not be judged against any money it
 * brought back. That is the gap this closes, and it is the first one worth
 * closing: everything else in a marketing plan is a guess until it can be
 * counted.
 *
 * Self-hosted rather than Google's, for three reasons that all matter to a
 * business this size. It runs on a server the shop already pays for, so it
 * adds nothing to the monthly bill. The customers' browsing stays on that
 * server instead of being handed to an advertising company. And the script is
 * a couple of kilobytes against Google's hundred-odd, which counts when the
 * reader is on a phone on Ronald Ngara Street.
 *
 * BOTH VALUES MUST BE SET OR NOTHING IS INJECTED. The site is a static export,
 * so these are read when the image is built, not when a page is served — see
 * the build args in the Dockerfile. An unconfigured build is a site with no
 * tracking at all rather than a site with a broken script tag in its head,
 * which is the right way round: the pages must not depend on the analytics
 * box being up.
 */
export const ANALYTICS = {
  /** Full URL of the tracker script, e.g. https://insights.example.co.ke/s.js */
  src: process.env.NEXT_PUBLIC_ANALYTICS_SRC ?? "",
  /** The site's id, created once in the analytics dashboard. */
  websiteId: process.env.NEXT_PUBLIC_ANALYTICS_ID ?? "",
} as const;

export const analyticsOn = Boolean(ANALYTICS.src && ANALYTICS.websiteId);
